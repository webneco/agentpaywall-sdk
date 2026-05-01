import {
  type ParsedTransactionWithMeta,
  type TokenBalance,
  Connection,
  PublicKey,
} from '@solana/web3.js';
import type {
  PaymentVerificationResult,
  VerificationErrorCode,
} from './types';

const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS = 6;
const RPC_TIMEOUT_MS = 30_000;
// Transactions older than this are rejected by default. Defence-in-depth on
// top of the replay store: bounds the reuse window even if the store is
// misconfigured or shared state drops.
const DEFAULT_MAX_TX_AGE_SECONDS = 300;

// Only Solana's public RPC hosts get mint inference. Custom / authenticated
// RPCs (Helius, QuickNode, Alchemy, etc.) MUST pass usdcMintAddress explicitly
// — substring-matching hostnames is brittle and was previously exploitable
// via names like `mainnet-staging.<custom>`.
const KNOWN_DEVNET_HOSTS = new Set(['api.devnet.solana.com']);
const KNOWN_MAINNET_HOSTS = new Set([
  'api.mainnet-beta.solana.com',
  'api.metaplex.solana.com',
]);

// Maps internal failure modes to stable, public-safe strings. Nothing
// returned to the client may contain dynamic state (RPC URLs, user-supplied
// strings, stack frames). The only dynamic detail surfaced is the numeric
// amount in INSUFFICIENT_AMOUNT, which is returned in its own field.
const PUBLIC_ERRORS: Record<VerificationErrorCode, string> = {
  MISSING_SIGNATURE: 'Missing transaction signature',
  INVALID_REQUEST: 'Invalid verification request',
  TX_NOT_FOUND: 'Transaction not found or not confirmed yet',
  TX_FAILED: 'Transaction failed on-chain — tokens were not transferred',
  TX_TOO_OLD: 'Transaction is older than the allowed freshness window',
  TX_TIME_UNAVAILABLE:
    'Transaction block time unavailable — cannot verify freshness',
  NO_USDC_TRANSFER:
    'No USDC transfer to the expected recipient was found in this transaction',
  WRONG_RECIPIENT: 'USDC transfer was not sent to the expected recipient wallet',
  INSUFFICIENT_AMOUNT: 'Insufficient USDC amount transferred to recipient',
  RPC_UNAVAILABLE:
    'Solana RPC request failed — retry or use a different endpoint',
  INTERNAL_ERROR: 'Internal verification error',
};

function fail(
  code: VerificationErrorCode,
  extra?: Partial<PaymentVerificationResult>,
): PaymentVerificationResult {
  return {
    valid: false,
    error: PUBLIC_ERRORS[code],
    errorCode: code,
    ...extra,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('RPC_TIMEOUT'));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function toBigInt(value: unknown): bigint | null {
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'bigint'
  ) {
    return null;
  }

  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function inferUsdcMint(rpcUrl: string): string | null {
  let host: string;
  try {
    host = new URL(rpcUrl).hostname;
  } catch {
    return null;
  }
  if (KNOWN_MAINNET_HOSTS.has(host)) return MAINNET_USDC;
  if (KNOWN_DEVNET_HOSTS.has(host)) return DEVNET_USDC;
  return null;
}

/**
 * Sums per-owner USDC balance deltas from meta.preTokenBalances /
 * meta.postTokenBalances. Using on-chain balance deltas rather than the
 * instruction `amount` field is critical:
 *   - The delta is the authoritative amount the recipient received, which
 *     correctly accounts for Token-2022 transfer-fee extensions (where the
 *     instruction amount is gross but the recipient's credit is net).
 *   - It naturally aggregates multiple transfers to the same owner.
 *   - It is immune to whatever an attacker can fit into an instruction
 *     list, because it reflects what actually settled.
 *
 * Each owner may have multiple token accounts for the same mint. We sum
 * across them so that a sender moving funds between their own ATAs doesn't
 * produce spurious "senders" in results.
 */
function computeUsdcOwnerDeltas(
  pre: readonly TokenBalance[] | null | undefined,
  post: readonly TokenBalance[] | null | undefined,
  usdcMintAddress: string,
): Map<string, bigint> {
  const preByOwner = new Map<string, bigint>();
  const postByOwner = new Map<string, bigint>();

  for (const entry of pre ?? []) {
    if (entry.mint !== usdcMintAddress || !entry.owner) continue;
    const amount = toBigInt(entry.uiTokenAmount.amount);
    if (amount === null) continue;
    preByOwner.set(entry.owner, (preByOwner.get(entry.owner) ?? 0n) + amount);
  }

  for (const entry of post ?? []) {
    if (entry.mint !== usdcMintAddress || !entry.owner) continue;
    const amount = toBigInt(entry.uiTokenAmount.amount);
    if (amount === null) continue;
    postByOwner.set(entry.owner, (postByOwner.get(entry.owner) ?? 0n) + amount);
  }

  const owners = new Set<string>();
  for (const owner of preByOwner.keys()) owners.add(owner);
  for (const owner of postByOwner.keys()) owners.add(owner);

  const deltas = new Map<string, bigint>();
  for (const owner of owners) {
    const preTotal = preByOwner.get(owner) ?? 0n;
    const postTotal = postByOwner.get(owner) ?? 0n;
    deltas.set(owner, postTotal - preTotal);
  }

  return deltas;
}

/**
 * Verifies that a Solana transaction credited the expected recipient with at
 * least the expected USDC amount. Never throws; all failure states return
 * `{ valid: false, error, errorCode }`.
 *
 * Security invariants:
 * - Failed transactions are rejected (`meta.err` truthy).
 * - Transactions older than `maxTxAgeSeconds` (default 300) are rejected.
 *   This bounds replay reuse even if the replay store is misconfigured.
 * - Verification uses balance deltas from `meta.pre/postTokenBalances`, not
 *   instruction `amount` fields, so Token-2022 transfer fees cannot cause
 *   under-payment to pass as valid.
 * - For custom / authenticated RPC endpoints you MUST pass `usdcMintAddress`
 *   explicitly; the inference path only recognises Solana's public RPC
 *   hosts and returns INVALID_REQUEST otherwise.
 * - No dynamic error text reaches the returned `error` field. Raw RPC
 *   errors (which may include private RPC URLs / API keys) are handed to
 *   `params.onError` and logged server-side only.
 * - Commitment is 'confirmed', not 'finalized', for latency. On mainnet
 *   reorgs past 'confirmed' are astronomically rare; callers who require
 *   finalized certainty should widen `maxTxAgeSeconds` and pre-wait client
 *   side.
 */
export async function verifyUSDCPayment(params: {
  txSignature: string;
  expectedRecipient: string;
  expectedAmountUsdc: number;
  rpcUrl: string;
  usdcMintAddress?: string;
  timeoutMs?: number;
  maxTxAgeSeconds?: number;
  onError?: (scope: string, error: unknown) => void;
}): Promise<PaymentVerificationResult> {
  const reportError = (scope: string, error: unknown): void => {
    try {
      params.onError?.(scope, error);
    } catch {
      // Never let a caller-supplied logger break verification.
    }
  };

  try {
    if (!params.txSignature?.trim()) {
      return fail('MISSING_SIGNATURE');
    }

    if (
      !Number.isFinite(params.expectedAmountUsdc) ||
      params.expectedAmountUsdc <= 0
    ) {
      return fail('INVALID_REQUEST');
    }

    try {
      void new PublicKey(params.expectedRecipient);
    } catch {
      return fail('INVALID_REQUEST');
    }

    const usdcMintAddress =
      params.usdcMintAddress ?? inferUsdcMint(params.rpcUrl);
    if (!usdcMintAddress) {
      return fail('INVALID_REQUEST');
    }

    try {
      void new PublicKey(usdcMintAddress);
    } catch {
      return fail('INVALID_REQUEST');
    }

    const expectedAmountRaw = toBigInt(
      Math.round(params.expectedAmountUsdc * 10 ** USDC_DECIMALS),
    );
    if (expectedAmountRaw === null || expectedAmountRaw <= 0n) {
      return fail('INVALID_REQUEST');
    }

    const timeoutMs = params.timeoutMs ?? RPC_TIMEOUT_MS;
    const connection = new Connection(params.rpcUrl, 'confirmed');

    let parsedTransaction: ParsedTransactionWithMeta | null;
    try {
      parsedTransaction = await withTimeout(
        connection.getParsedTransaction(params.txSignature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        }),
        timeoutMs,
      );
    } catch (error) {
      reportError('getParsedTransaction', error);
      return fail('RPC_UNAVAILABLE');
    }

    if (!parsedTransaction || !parsedTransaction.meta) {
      return fail('TX_NOT_FOUND');
    }

    if (parsedTransaction.meta.err) {
      return fail('TX_FAILED');
    }

    const maxTxAgeSeconds =
      params.maxTxAgeSeconds ?? DEFAULT_MAX_TX_AGE_SECONDS;

    if (maxTxAgeSeconds > 0) {
      if (parsedTransaction.blockTime == null) {
        return fail('TX_TIME_UNAVAILABLE');
      }
      const ageSeconds =
        Math.floor(Date.now() / 1000) - parsedTransaction.blockTime;
      if (ageSeconds > maxTxAgeSeconds) {
        return fail('TX_TOO_OLD');
      }
    }

    const deltas = computeUsdcOwnerDeltas(
      parsedTransaction.meta.preTokenBalances,
      parsedTransaction.meta.postTokenBalances,
      usdcMintAddress,
    );

    const recipientDelta = deltas.get(params.expectedRecipient) ?? 0n;

    // Derive sender from the largest net USDC debit on this tx. This reflects
    // what actually settled rather than what a delegate field reported.
    let senderWallet: string | undefined;
    let largestNegativeDelta = 0n;
    for (const [owner, delta] of deltas.entries()) {
      if (delta < largestNegativeDelta) {
        largestNegativeDelta = delta;
        senderWallet = owner;
      }
    }

    if (recipientDelta <= 0n) {
      // Distinguish "someone else got USDC" from "no USDC moved at all" for
      // clearer developer-facing errors.
      let anyUsdcCredit = false;
      for (const delta of deltas.values()) {
        if (delta > 0n) {
          anyUsdcCredit = true;
          break;
        }
      }
      return fail(anyUsdcCredit ? 'WRONG_RECIPIENT' : 'NO_USDC_TRANSFER');
    }

    if (recipientDelta < expectedAmountRaw) {
      return fail('INSUFFICIENT_AMOUNT', {
        actualAmountUsdc: Number(recipientDelta) / 10 ** USDC_DECIMALS,
        senderWallet,
      });
    }

    return {
      valid: true,
      actualAmountUsdc: Number(recipientDelta) / 10 ** USDC_DECIMALS,
      senderWallet,
    };
  } catch (error: unknown) {
    reportError('verifyUSDCPayment', error);
    return fail('INTERNAL_ERROR');
  }
}
