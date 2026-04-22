import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockState = {
  parsedTransaction: unknown;
  accountInfoByPubkey: Map<string, unknown>;
  transactionError: Error | null;
  transactionDelayMs: number;
};

const mockState: MockState = {
  parsedTransaction: null,
  accountInfoByPubkey: new Map<string, unknown>(),
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

    async getParsedAccountInfo(publicKey: { toBase58?: () => string }) {
      const address =
        typeof publicKey?.toBase58 === 'function'
          ? publicKey.toBase58()
          : String(publicKey);

      return {
        value: mockState.accountInfoByPubkey.get(address) ?? null,
      };
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

function tokenAccountInfo(owner: string, mint: string): unknown {
  return {
    data: {
      parsed: {
        info: {
          owner,
          mint,
        },
      },
    },
  };
}

function parsedTransferCheckedInstruction(params: {
  amountRaw: string;
  destinationTokenAccount: string;
  sourceTokenAccount?: string;
  authority?: string;
  mint?: string;
}): unknown {
  return {
    program: 'spl-token',
    parsed: {
      type: 'transferChecked',
      info: {
        amount: params.amountRaw,
        tokenAmount: {
          amount: params.amountRaw,
          decimals: 6,
        },
        destination: params.destinationTokenAccount,
        source: params.sourceTokenAccount,
        authority: params.authority,
        mint: params.mint,
      },
    },
  };
}

function mockParsedTransaction(instructions: unknown[]): unknown {
  return {
    meta: {
      innerInstructions: [],
    },
    transaction: {
      message: {
        instructions,
      },
    },
  };
}

describe('verifyUSDCPayment', () => {
  beforeEach(() => {
    mockState.parsedTransaction = null;
    mockState.accountInfoByPubkey = new Map<string, unknown>();
    mockState.transactionError = null;
    mockState.transactionDelayMs = 0;
    vi.useRealTimers();
  });

  it('returns invalid when transaction signature is missing', async () => {
    const result = await verifyUSDCPayment({
      txSignature: '',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Missing transaction signature');
  });

  it('returns invalid when transaction is not found', async () => {
    mockState.parsedTransaction = null;

    const result = await verifyUSDCPayment({
      txSignature: '5rSig1111111111111111111111111111111111111111111111111',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Transaction not found or not confirmed yet');
  });

  it('returns invalid when no token transfer instruction exists', async () => {
    mockState.parsedTransaction = mockParsedTransaction([
      {
        program: 'system',
        parsed: {
          type: 'transfer',
          info: {
            lamports: 1000,
          },
        },
      },
    ]);

    const result = await verifyUSDCPayment({
      txSignature: '6sSig1111111111111111111111111111111111111111111111111',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('No SPL token Transfer/TransferChecked');
  });

  it('returns invalid when transfer is not USDC mint', async () => {
    const destinationTokenAccount = 'DestTokenAcct111111111111111111111111111111';

    mockState.parsedTransaction = mockParsedTransaction([
      parsedTransferCheckedInstruction({
        amountRaw: '1000',
        destinationTokenAccount,
        mint: 'OtherMint1111111111111111111111111111111111111',
      }),
    ]);

    mockState.accountInfoByPubkey.set(
      destinationTokenAccount,
      tokenAccountInfo(EXPECTED_RECIPIENT, 'OtherMint1111111111111111111111111111111111111'),
    );

    const result = await verifyUSDCPayment({
      txSignature: '7tSig1111111111111111111111111111111111111111111111111',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('No USDC transfer found in transaction');
  });

  it('returns invalid when USDC transfer is sent to a different recipient owner', async () => {
    const destinationTokenAccount = 'DestTokenAcct222222222222222222222222222222';

    mockState.parsedTransaction = mockParsedTransaction([
      parsedTransferCheckedInstruction({
        amountRaw: '1000',
        destinationTokenAccount,
        mint: EXPECTED_USDC_MINT,
      }),
    ]);

    mockState.accountInfoByPubkey.set(
      destinationTokenAccount,
      tokenAccountInfo(
        'AnotherRecipient1111111111111111111111111111',
        EXPECTED_USDC_MINT,
      ),
    );

    const result = await verifyUSDCPayment({
      txSignature: '8uSig1111111111111111111111111111111111111111111111111',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain(
      'USDC transfer was not sent to the expected recipient',
    );
  });

  it('returns invalid with actual amount when amount is insufficient', async () => {
    const destinationTokenAccount = 'DestTokenAcct333333333333333333333333333333';
    const sourceTokenAccount = 'SourceTokenAcct33333333333333333333333333333';

    mockState.parsedTransaction = mockParsedTransaction([
      parsedTransferCheckedInstruction({
        amountRaw: '500',
        destinationTokenAccount,
        sourceTokenAccount,
        authority: 'SenderAuthority33333333333333333333333333333',
        mint: EXPECTED_USDC_MINT,
      }),
    ]);

    mockState.accountInfoByPubkey.set(
      destinationTokenAccount,
      tokenAccountInfo(EXPECTED_RECIPIENT, EXPECTED_USDC_MINT),
    );
    mockState.accountInfoByPubkey.set(
      sourceTokenAccount,
      tokenAccountInfo('SenderWallet3333333333333333333333333333333', EXPECTED_USDC_MINT),
    );

    const result = await verifyUSDCPayment({
      txSignature: '9vSig1111111111111111111111111111111111111111111111111',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Insufficient USDC amount');
    expect(result.actualAmountUsdc).toBe(0.0005);
    expect(result.senderWallet).toBe('SenderAuthority33333333333333333333333333333');
  });

  it('returns valid when transferChecked in inner instructions meets recipient and amount', async () => {
    const destinationTokenAccount = 'DestTokenAcct444444444444444444444444444444';
    const sourceTokenAccount = 'SourceTokenAcct44444444444444444444444444444';

    mockState.parsedTransaction = {
      meta: {
        innerInstructions: [
          {
            instructions: [
              parsedTransferCheckedInstruction({
                amountRaw: '1500',
                destinationTokenAccount,
                sourceTokenAccount,
                authority: 'SenderAuthority44444444444444444444444444444',
                mint: EXPECTED_USDC_MINT,
              }),
            ],
          },
        ],
      },
      transaction: {
        message: {
          instructions: [],
        },
      },
    };

    mockState.accountInfoByPubkey.set(
      destinationTokenAccount,
      tokenAccountInfo(EXPECTED_RECIPIENT, EXPECTED_USDC_MINT),
    );
    mockState.accountInfoByPubkey.set(
      sourceTokenAccount,
      tokenAccountInfo('SenderWallet4444444444444444444444444444444', EXPECTED_USDC_MINT),
    );

    const result = await verifyUSDCPayment({
      txSignature: 'AaSig1111111111111111111111111111111111111111111111111',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(true);
    expect(result.actualAmountUsdc).toBe(0.0015);
    expect(result.senderWallet).toBe('SenderAuthority44444444444444444444444444444');
  });

  it('returns invalid with network error details when RPC call fails', async () => {
    mockState.transactionError = new Error('RPC unavailable');

    const result = await verifyUSDCPayment({
      txSignature: 'BbSig1111111111111111111111111111111111111111111111111',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Verification failed: RPC unavailable');
  });

  it('returns invalid when transaction fetch times out', async () => {
    vi.useFakeTimers();
    mockState.transactionDelayMs = 60_000;

    const resultPromise = verifyUSDCPayment({
      txSignature: 'CcSig1111111111111111111111111111111111111111111111111',
      expectedRecipient: EXPECTED_RECIPIENT,
      expectedAmountUsdc: 0.001,
      rpcUrl: 'https://api.devnet.solana.com',
      usdcMintAddress: EXPECTED_USDC_MINT,
    });

    await vi.advanceTimersByTimeAsync(30_000);
    const result = await resultPromise;

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Timed out while fetching transaction from RPC');
  });
});