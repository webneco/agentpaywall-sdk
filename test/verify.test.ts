import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockState = {
  parsedTransaction: unknown;
  transactionError: Error | null;
  transactionDelayMs: number;
};

const mockState: MockState = {
  parsedTransaction: null,
  transactionError: null,
  transactionDelayMs: 0,
};

vi.mock('@solana/web3.js', () => {
  class MockPublicKey {
    private readonly value: string;

    constructor(value: string) {
      if (!value || typeof value !== 'string' || value.length < 8) {
        throw new Error('Invalid public key');
      }
      this.value = value;
    }

    toBase58(): string {
      return this.value;
    }
  }

  class MockConnection {
    constructor(_rpcUrl: string, _commitment: string) {}

    async getParsedTransaction(_signature: string): Promise<unknown> {
      if (mockState.transactionError) {
        throw mockState.transactionError;
      }

      if (mockState.transactionDelayMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, mockState.transactionDelayMs);
        });
      }

      return mockState.parsedTransaction;
    }
  }

  return {
    Connection: MockConnection,
    PublicKey: MockPublicKey,
  };
});

import { verifyUSDCPayment } from '../src/verify';

const EXPECTED_RECIPIENT = 'RecipientWallet1111111111111111111111111';
const EXPECTED_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const OTHER_MINT = 'OtherMint1111111111111111111111111111111111111';
const SENDER_WALLET = 'SenderWallet22222222222222222222222222222222';

type TokenBalanceEntry = {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
    uiAmount: number;
    uiAmountString: string;
  };
};

function tokenBalance(
  accountIndex: number,
  owner: string,
  mint: string,
  amountRaw: string,
): TokenBalanceEntry {
  const decimals = 6;
  const uiAmount = Number(BigInt(amountRaw)) / 10 ** decimals;
  return {
    accountIndex,
    mint,
    owner,
    programId: 'spl-token',
    uiTokenAmount: {
      amount: amountRaw,
      decimals,
      uiAmount,
      uiAmountString: String(uiAmount),
    },
  };
}

type MockTxOptions = {
  preTokenBalances?: TokenBalanceEntry[];
  postTokenBalances?: TokenBalanceEntry[];
  err?: unknown;
  blockTime?: number | null;
};

function mockTx(opts: MockTxOptions = {}): unknown {
  const blockTime =
    'blockTime' in opts ? opts.blockTime : Math.floor(Date.now() / 1000);
  return {
    meta: {
      err: opts.err ?? null,
      preTokenBalances: opts.preTokenBalances ?? [],
      postTokenBalances: opts.postTokenBalances ?? [],
      innerInstructions: [],
    },
    blockTime,
    transaction: {
      message: {
        instructions: [],
      },
    },
  };
}

describe('verifyUSDCPayment', () => {
  beforeEach(() => {
    mockState.parsedTransaction = null;
    mockState.transactionError = null;
    mockState.transactionDelayMs = 0;
    vi.useRealTimers();
  });

  it('rejects a missing signature with MISSING_SIGNATURE', async () => {
    const result = await verifyUSDCPayment({
      txSignature: '',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('MISSING_SIGNATURE');
  });

  it('rejects non-positive amounts with INVALID_REQUEST', async () => {
    const result = await verifyUSDCPayment({
      txSignature: 'Sig11111111111111111111111111111111111111111',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('INVALID_REQUEST');
  });

  it('requires explicit usdcMintAddress for unknown RPC hosts', async () => {
    const result = await verifyUSDCPayment({
      txSignature: 'Sig22222222222222222222222222222222222222222',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://mainnet-something-custom.example.com',
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('INVALID_REQUEST');
  });

  it('returns TX_NOT_FOUND when the RPC returns null', async () => {
    mockState.parsedTransaction = null;

    const result = await verifyUSDCPayment({
      txSignature: '5rSig1111111111111111111111111111111111111111111111111',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('TX_NOT_FOUND');
  });

  it('returns TX_FAILED when the on-chain tx errored', async () => {
    mockState.parsedTransaction = mockTx({
      err: { InstructionError: [0, 'Custom'] },
      preTokenBalances: [],
      postTokenBalances: [],
    });

    const result = await verifyUSDCPayment({
      txSignature: 'Sig33333333333333333333333333333333333333333',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('TX_FAILED');
  });

  it('returns TX_TOO_OLD when blockTime is past the freshness window', async () => {
    mockState.parsedTransaction = mockTx({
      blockTime: Math.floor(Date.now() / 1000) - 10_000,
      preTokenBalances: [tokenBalance(0, EXPECTED_RECIPIENT, EXPECTED_USDC_MINT, '0')],
      postTokenBalances: [
        tokenBalance(0, EXPECTED_RECIPIENT, EXPECTED_USDC_MINT, '1000'),
      ],
    });

    const result = await verifyUSDCPayment({
      txSignature: 'Sig44444444444444444444444444444444444444444',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('TX_TOO_OLD');
  });

  it('returns TX_TIME_UNAVAILABLE when blockTime is missing and freshness is enforced', async () => {
    mockState.parsedTransaction = mockTx({
      blockTime: null,
      preTokenBalances: [tokenBalance(0, EXPECTED_RECIPIENT, EXPECTED_USDC_MINT, '0')],
      postTokenBalances: [
        tokenBalance(0, EXPECTED_RECIPIENT, EXPECTED_USDC_MINT, '1000'),
      ],
    });

    const result = await verifyUSDCPayment({
      txSignature: 'Sig55555555555555555555555555555555555555555',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('TX_TIME_UNAVAILABLE');
  });

  it('returns NO_USDC_TRANSFER when no USDC moved', async () => {
    mockState.parsedTransaction = mockTx({
      preTokenBalances: [tokenBalance(0, SENDER_WALLET, OTHER_MINT, '1000')],
      postTokenBalances: [
        tokenBalance(0, SENDER_WALLET, OTHER_MINT, '0'),
        tokenBalance(1, EXPECTED_RECIPIENT, OTHER_MINT, '1000'),
      ],
    });

    const result = await verifyUSDCPayment({
      txSignature: 'Sig66666666666666666666666666666666666666666',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('NO_USDC_TRANSFER');
  });

  it('returns WRONG_RECIPIENT when USDC was transferred to someone else', async () => {
    mockState.parsedTransaction = mockTx({
      preTokenBalances: [tokenBalance(0, SENDER_WALLET, EXPECTED_USDC_MINT, '1000')],
      postTokenBalances: [
        tokenBalance(0, SENDER_WALLET, EXPECTED_USDC_MINT, '0'),
        tokenBalance(
          1,
          'AnotherRecipient1111111111111111111111111111',
          EXPECTED_USDC_MINT,
          '1000',
        ),
      ],
    });

    const result = await verifyUSDCPayment({
      txSignature: 'Sig77777777777777777777777777777777777777777',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('WRONG_RECIPIENT');
  });

  it('returns INSUFFICIENT_AMOUNT with actual amount and sender when credit is under expected', async () => {
    mockState.parsedTransaction = mockTx({
      preTokenBalances: [
        tokenBalance(0, SENDER_WALLET, EXPECTED_USDC_MINT, '500'),
        tokenBalance(1, EXPECTED_RECIPIENT, EXPECTED_USDC_MINT, '0'),
      ],
      postTokenBalances: [
        tokenBalance(0, SENDER_WALLET, EXPECTED_USDC_MINT, '0'),
        tokenBalance(1, EXPECTED_RECIPIENT, EXPECTED_USDC_MINT, '500'),
      ],
    });

    const result = await verifyUSDCPayment({
      txSignature: 'Sig88888888888888888888888888888888888888888',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('INSUFFICIENT_AMOUNT');
    expect(result.actualAmountUsdc).toBe(0.0005);
    expect(result.senderWallet).toBe(SENDER_WALLET);
  });

  it('returns valid when the recipient delta meets the expected amount', async () => {
    mockState.parsedTransaction = mockTx({
      preTokenBalances: [
        tokenBalance(0, SENDER_WALLET, EXPECTED_USDC_MINT, '2000'),
        tokenBalance(1, EXPECTED_RECIPIENT, EXPECTED_USDC_MINT, '0'),
      ],
      postTokenBalances: [
        tokenBalance(0, SENDER_WALLET, EXPECTED_USDC_MINT, '500'),
        tokenBalance(1, EXPECTED_RECIPIENT, EXPECTED_USDC_MINT, '1500'),
      ],
    });

    const result = await verifyUSDCPayment({
      txSignature: 'Sig99999999999999999999999999999999999999999',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(true);
    expect(result.actualAmountUsdc).toBe(0.0015);
    expect(result.senderWallet).toBe(SENDER_WALLET);
  });

  it('credits the destination correctly when multiple USDC ATAs belong to the recipient', async () => {
    mockState.parsedTransaction = mockTx({
      preTokenBalances: [
        tokenBalance(0, SENDER_WALLET, EXPECTED_USDC_MINT, '2000'),
        tokenBalance(1, EXPECTED_RECIPIENT, EXPECTED_USDC_MINT, '100'),
        tokenBalance(2, EXPECTED_RECIPIENT, EXPECTED_USDC_MINT, '200'),
      ],
      postTokenBalances: [
        tokenBalance(0, SENDER_WALLET, EXPECTED_USDC_MINT, '0'),
        tokenBalance(1, EXPECTED_RECIPIENT, EXPECTED_USDC_MINT, '1100'),
        tokenBalance(2, EXPECTED_RECIPIENT, EXPECTED_USDC_MINT, '1200'),
      ],
    });

    const result = await verifyUSDCPayment({
      txSignature: 'SigAA2A2A2A2A2A2A2A2A2A2A2A2A2A2A2A2A2A2A2A2',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.002,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(true);
    expect(result.actualAmountUsdc).toBe(0.002);
  });

  it('ignores non-USDC transfers when computing the delta (Token-2022 fee hardening)', async () => {
    // A large delta on a different mint must not count toward the USDC credit.
    mockState.parsedTransaction = mockTx({
      preTokenBalances: [
        tokenBalance(0, SENDER_WALLET, EXPECTED_USDC_MINT, '400'),
        tokenBalance(1, EXPECTED_RECIPIENT, EXPECTED_USDC_MINT, '0'),
        tokenBalance(2, SENDER_WALLET, OTHER_MINT, '10000'),
        tokenBalance(3, EXPECTED_RECIPIENT, OTHER_MINT, '0'),
      ],
      postTokenBalances: [
        tokenBalance(0, SENDER_WALLET, EXPECTED_USDC_MINT, '0'),
        tokenBalance(1, EXPECTED_RECIPIENT, EXPECTED_USDC_MINT, '400'),
        tokenBalance(2, SENDER_WALLET, OTHER_MINT, '0'),
        tokenBalance(3, EXPECTED_RECIPIENT, OTHER_MINT, '10000'),
      ],
    });

    const result = await verifyUSDCPayment({
      txSignature: 'SigBB2B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001, // 1000 raw USDC required, only 400 received
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('INSUFFICIENT_AMOUNT');
    expect(result.actualAmountUsdc).toBe(0.0004);
  });

  it('returns RPC_UNAVAILABLE without leaking the raw error text', async () => {
    mockState.transactionError = new Error(
      'fetch failed: https://rpc.example.com/?api-key=SECRET_KEY_123',
    );

    const result = await verifyUSDCPayment({
      txSignature: 'SigCC2C2C2C2C2C2C2C2C2C2C2C2C2C2C2C2C2C2C2C2',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('RPC_UNAVAILABLE');
    expect(result.error).not.toContain('SECRET_KEY_123');
    expect(result.error).not.toContain('rpc.example.com');
    expect(result.error).not.toContain('api-key');
  });

  it('delivers the raw RPC error to onError server-side only', async () => {
    const secret = 'https://rpc.example.com/?api-key=SECRET_KEY_123';
    mockState.transactionError = new Error(`fetch failed: ${secret}`);

    const captured: Array<{ scope: string; error: unknown }> = [];
    const result = await verifyUSDCPayment({
      txSignature: 'SigDD2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
      onError: (scope, error) => captured.push({ scope, error }),
    });

    expect(result.valid).toBe(false);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.scope).toBe('getParsedTransaction');
    expect((captured[0]?.error as Error).message).toContain(secret);
  });

  it('times out cleanly with RPC_UNAVAILABLE', async () => {
    vi.useFakeTimers();
    mockState.transactionDelayMs = 60_000;

    const resultPromise = verifyUSDCPayment({
      txSignature: 'SigEE2E2E2E2E2E2E2E2E2E2E2E2E2E2E2E2E2E2E2E2',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    await vi.advanceTimersByTimeAsync(30_000);
    const result = await resultPromise;

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('RPC_UNAVAILABLE');
  });
});
