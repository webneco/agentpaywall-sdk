import {
  type ParsedAccountData,
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
  type PartiallyDecodedInstruction,
  Connection,
  PublicKey,
} from '@solana/web3.js';
import type { PaymentVerificationResult } from './types';

const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS = 6;
const RPC_TIMEOUT_MS = 30_000;

type TokenAccountMeta = {
  owner: string;
  mint: string;
};

type ParsedTokenTransfer = {
  amountRaw: bigint;
  sourceTokenAccount?: string;
  destinationTokenAccount: string;
  senderAuthority?: string;
  mintFromInstruction?: string;
};

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
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

function isParsedInstruction(
  instruction: ParsedInstruction | PartiallyDecodedInstruction,
): instruction is ParsedInstruction {
  return 'parsed' in instruction;
}

function isTokenProgram(program: string): boolean {
  return program === 'spl-token' || program === 'spl-token-2022';
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

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unknown verification error';
}

function inferDefaultUsdcMint(rpcUrl: string): string {
  return rpcUrl.includes('mainnet') ? MAINNET_USDC : DEVNET_USDC;
}

function parseTransferInstruction(
  instruction: ParsedInstruction,
): ParsedTokenTransfer | null {
  if (!isTokenProgram(instruction.program)) {
    return null;
  }

  if (
    typeof instruction.parsed !== 'object' ||
    instruction.parsed === null ||
    !('type' in instruction.parsed) ||
    !('info' in instruction.parsed)
  ) {
    return null;
  }

  const parsed = instruction.parsed as {
    type?: unknown;
    info?: unknown;
  };

  if (parsed.type !== 'transfer' && parsed.type !== 'transferChecked') {
    return null;
  }

  if (typeof parsed.info !== 'object' || parsed.info === null) {
    return null;
  }

  const info = parsed.info as Record<string, unknown>;

  const destinationTokenAccount =
    typeof info.destination === 'string' ? info.destination : undefined;
  if (!destinationTokenAccount) {
    return null;
  }

  const sourceTokenAccount =
    typeof info.source === 'string' ? info.source : undefined;
  const senderAuthority =
    typeof info.authority === 'string' ? info.authority : undefined;
  const mintFromInstruction =
    typeof info.mint === 'string' ? info.mint : undefined;

  let amountRaw: bigint | null = null;

  if (parsed.type === 'transferChecked') {
    const tokenAmount = info.tokenAmount;
    if (typeof tokenAmount === 'object' && tokenAmount !== null) {
      amountRaw = toBigInt(
        (tokenAmount as { amount?: unknown }).amount,
      );
    }

    if (amountRaw === null) {
      amountRaw = toBigInt(info.amount);
    }
  } else {
    amountRaw = toBigInt(info.amount);
  }

  if (amountRaw === null) {
    return null;
  }

  return {
    amountRaw,
    sourceTokenAccount,
    destinationTokenAccount,
    senderAuthority,
    mintFromInstruction,
  };
}

function collectParsedInstructions(
  transaction: ParsedTransactionWithMeta,
): ParsedInstruction[] {
  const parsedInstructions: ParsedInstruction[] = [];

  for (const instruction of transaction.transaction.message.instructions) {
    if (isParsedInstruction(instruction)) {
      parsedInstructions.push(instruction);
    }
  }

  for (const innerInstruction of transaction.meta?.innerInstructions ?? []) {
    for (const instruction of innerInstruction.instructions) {
      if (isParsedInstruction(instruction)) {
        parsedInstructions.push(instruction);
      }
    }
  }

  return parsedInstructions;
}

function readTokenAccountMeta(value: unknown): TokenAccountMeta | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const accountValue = value as {
    data?: unknown;
  };
  const data = accountValue.data;

  if (typeof data !== 'object' || data === null || !('parsed' in data)) {
    return null;
  }

  const parsedData = data as ParsedAccountData;
  if (typeof parsedData.parsed !== 'object' || parsedData.parsed === null) {
    return null;
  }

  const parsed = parsedData.parsed as {
    info?: unknown;
  };

  if (typeof parsed.info !== 'object' || parsed.info === null) {
    return null;
  }

  const info = parsed.info as Record<string, unknown>;
  const owner = typeof info.owner === 'string' ? info.owner : undefined;
  const mint = typeof info.mint === 'string' ? info.mint : undefined;

  if (!owner || !mint) {
    return null;
  }

  return { owner, mint };
}

async function getTokenAccountMeta(
  connection: Connection,
  tokenAccountAddress: string,
  cache: Map<string, TokenAccountMeta | null>,
): Promise<TokenAccountMeta | null> {
  if (cache.has(tokenAccountAddress)) {
    return cache.get(tokenAccountAddress) ?? null;
  }

  let publicKey: PublicKey;
  try {
    publicKey = new PublicKey(tokenAccountAddress);
  } catch {
    cache.set(tokenAccountAddress, null);
    return null;
  }

  try {
    const accountInfo = await withTimeout(
      connection.getParsedAccountInfo(publicKey, 'confirmed'),
      RPC_TIMEOUT_MS,
      'Timed out while fetching token account metadata',
    );

    const meta = readTokenAccountMeta(accountInfo.value);
    cache.set(tokenAccountAddress, meta);
    return meta;
  } catch {
    cache.set(tokenAccountAddress, null);
    return null;
  }
}

/**
 * Verifies that a Solana transaction contains a USDC transfer meeting the expected amount and recipient.
 * This function never throws; all failure states are returned as { valid: false, error }.
 */
export async function verifyUSDCPayment(params: {
  txSignature: string;
  expectedRecipient: string;
  expectedAmountUsdc: number;
  rpcUrl: string;
  usdcMintAddress?: string;
}): Promise<PaymentVerificationResult> {
  try {
    if (!params.txSignature?.trim()) {
      return { valid: false, error: 'Missing transaction signature' };
    }

    if (
      !Number.isFinite(params.expectedAmountUsdc) ||
      params.expectedAmountUsdc <= 0
    ) {
      return { valid: false, error: 'Expected amount must be greater than zero' };
    }

    try {
      void new PublicKey(params.expectedRecipient);
    } catch {
      return { valid: false, error: 'Invalid expected recipient wallet address' };
    }

    const usdcMintAddress =
      params.usdcMintAddress ?? inferDefaultUsdcMint(params.rpcUrl);

    try {
      void new PublicKey(usdcMintAddress);
    } catch {
      return { valid: false, error: 'Invalid USDC mint address' };
    }

    const expectedAmountRaw = toBigInt(
      Math.round((params.expectedAmountUsdc + Number.EPSILON) * 10 ** USDC_DECIMALS),
    );

    if (expectedAmountRaw === null || expectedAmountRaw <= 0n) {
      return {
        valid: false,
        error: 'Expected amount is too small after USDC decimal conversion',
      };
    }

    const connection = new Connection(params.rpcUrl, 'confirmed');

    const parsedTransaction = await withTimeout(
      connection.getParsedTransaction(params.txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      }),
      RPC_TIMEOUT_MS,
      'Timed out while fetching transaction from RPC',
    );

    if (!parsedTransaction) {
      return {
        valid: false,
        error: 'Transaction not found or not confirmed yet',
      };
    }

    if (!parsedTransaction.meta) {
      return {
        valid: false,
        error: 'Malformed transaction: missing metadata',
      };
    }

    const parsedInstructions = collectParsedInstructions(parsedTransaction);
    const tokenAccountCache = new Map<string, TokenAccountMeta | null>();

    let sawTokenTransfer = false;
    let sawUsdcTransfer = false;
    let sawExpectedRecipient = false;
    let bestAmountRaw = 0n;
    let bestSenderWallet: string | undefined;

    for (const instruction of parsedInstructions) {
      const transfer = parseTransferInstruction(instruction);
      if (!transfer) {
        continue;
      }

      sawTokenTransfer = true;

      const destinationMeta = await getTokenAccountMeta(
        connection,
        transfer.destinationTokenAccount,
        tokenAccountCache,
      );

      if (!destinationMeta) {
        continue;
      }

      const mintMatches =
        destinationMeta.mint === usdcMintAddress &&
        (transfer.mintFromInstruction === undefined ||
          transfer.mintFromInstruction === usdcMintAddress);

      if (!mintMatches) {
        continue;
      }

      sawUsdcTransfer = true;

      if (destinationMeta.owner !== params.expectedRecipient) {
        continue;
      }

      sawExpectedRecipient = true;

      const sourceMeta = transfer.sourceTokenAccount
        ? await getTokenAccountMeta(
            connection,
            transfer.sourceTokenAccount,
            tokenAccountCache,
          )
        : null;

      if (transfer.amountRaw > bestAmountRaw) {
        bestAmountRaw = transfer.amountRaw;
        bestSenderWallet = transfer.senderAuthority ?? sourceMeta?.owner;
      }

      if (transfer.amountRaw >= expectedAmountRaw) {
        return {
          valid: true,
          actualAmountUsdc: Number(transfer.amountRaw) / 10 ** USDC_DECIMALS,
          senderWallet: transfer.senderAuthority ?? sourceMeta?.owner,
        };
      }
    }

    if (!sawTokenTransfer) {
      return {
        valid: false,
        error: 'No SPL token Transfer/TransferChecked instruction found',
      };
    }

    if (!sawUsdcTransfer) {
      return {
        valid: false,
        error: 'No USDC transfer found in transaction',
      };
    }

    if (!sawExpectedRecipient) {
      return {
        valid: false,
        error: 'USDC transfer was not sent to the expected recipient',
      };
    }

    if (bestAmountRaw > 0n) {
      return {
        valid: false,
        actualAmountUsdc: Number(bestAmountRaw) / 10 ** USDC_DECIMALS,
        senderWallet: bestSenderWallet,
        error: 'Insufficient USDC amount',
      };
    }

    return {
      valid: false,
      error: 'Unable to verify payment from transaction',
    };
  } catch (error: unknown) {
    return {
      valid: false,
      error: `Verification failed: ${safeErrorMessage(error)}`,
    };
  }
}