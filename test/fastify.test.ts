import { describe, expect, it, vi } from 'vitest';
import { agentPaywallFastify } from '../src/fastify';
import type { AgentPaywallConfig } from '../src/types';

// Mock the verify module
vi.mock('../src/verify', () => ({
  verifyUSDCPayment: vi.fn(),
}));

// Mock the payment-response module
vi.mock('../src/payment-response', () => ({
  build402Response: vi.fn((config) => ({
    error: 'Payment Required',
    code: 'PAYMENT_REQUIRED',
    paymentDetails: {
      network: 'solana',
      currency: 'USDC',
      amount: config.priceUsdc,
      recipient: config.recipientWallet,
      memo: config.apiId,
      usdcMintAddress: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      rpcUrl: 'https://api.devnet.solana.com',
    },
    instructions: 'Test instructions',
    example: {
      header: 'X-Payment-Proof',
      value: 'test_signature',
      description: 'Test description',
    },
  })),
  resolveRpcUrl: vi.fn(() => 'https://api.devnet.solana.com'),
  resolveUsdcMintAddress: vi.fn(
    () => '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
  ),
}));

// Mock the recorder module
vi.mock('../src/recorder', () => ({
  recordTransaction: vi.fn(),
}));

// Mock the replay-store module
vi.mock('../src/replay-store', () => ({
  createInMemoryReplayStore: vi.fn(() => ({
    seen: vi.fn(async () => false),
  })),
  maybeWarnAboutMultiInstanceReplay: vi.fn(),
}));

import { verifyUSDCPayment } from '../src/verify';
import { recordTransaction } from '../src/recorder';
import {
  createInMemoryReplayStore,
  maybeWarnAboutMultiInstanceReplay,
} from '../src/replay-store';

const baseConfig: AgentPaywallConfig = {
  priceUsdc: 0.001,
  recipientWallet: 'RecipientWallet1111111111111111111111111',
  apiId: 'api_test',
};

describe('agentPaywallFastify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 402 when no payment proof header is provided', async () => {
    const preHandler = agentPaywallFastify(baseConfig);

    const mockRequest = {
      headers: {},
    };

    const mockReply = {
      code: vi.fn(function () {
        return this;
      }),
      header: vi.fn(function () {
        return this;
      }),
      send: vi.fn(),
    };

    await preHandler(mockRequest, mockReply as any);

    expect(mockReply.code).toHaveBeenCalledWith(402);
    expect(mockReply.header).toHaveBeenCalledWith(
      'Content-Type',
      'application/json'
    );
    expect(mockReply.send).toHaveBeenCalled();
  });

  it('returns 402 when x-payment-proof header is empty', async () => {
    const preHandler = agentPaywallFastify(baseConfig);

    const mockRequest = {
      headers: {
        'x-payment-proof': '',
      },
    };

    const mockReply = {
      code: vi.fn(function () {
        return this;
      }),
      header: vi.fn(function () {
        return this;
      }),
      send: vi.fn(),
    };

    await preHandler(mockRequest, mockReply as any);

    expect(mockReply.code).toHaveBeenCalledWith(402);
  });

  it('handles array of header values and uses the first one', async () => {
    const verifyMock = vi.mocked(verifyUSDCPayment);
    verifyMock.mockResolvedValueOnce({
      valid: true,
      actualAmountUsdc: 0.001,
      senderWallet: 'SenderWallet22222222222222222222222222222222',
    });

    const preHandler = agentPaywallFastify(baseConfig);

    const mockRequest = {
      headers: {
        'x-payment-proof': ['first_sig', 'second_sig'],
      },
    };

    const mockReply = {
      code: vi.fn(function () {
        return this;
      }),
      header: vi.fn(function () {
        return this;
      }),
      send: vi.fn(),
    };

    await preHandler(mockRequest, mockReply as any);

    expect(verifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        txSignature: 'first_sig',
      })
    );
  });

  it('rejects replayed transactions when replay protection is enabled', async () => {
    const replayStore = {
      seen: vi.fn(async () => true), // Already seen
    };

    const configWithReplay = {
      ...baseConfig,
      replayStore,
    };

    const preHandler = agentPaywallFastify(configWithReplay);

    const mockRequest = {
      headers: {
        'x-payment-proof': 'replayed_signature',
      },
    };

    const mockReply = {
      code: vi.fn(function () {
        return this;
      }),
      header: vi.fn(function () {
        return this;
      }),
      send: vi.fn(),
    };

    await preHandler(mockRequest, mockReply as any);

    expect(mockReply.code).toHaveBeenCalledWith(403);
    const sentPayload = mockReply.send.mock.calls[0][0];
    expect(sentPayload.code).toBe('REPLAY_DETECTED');
  });

  it('allows replay when allowReplay is true', async () => {
    const verifyMock = vi.mocked(verifyUSDCPayment);
    verifyMock.mockResolvedValueOnce({
      valid: true,
      actualAmountUsdc: 0.001,
      senderWallet: 'SenderWallet22222222222222222222222222222222',
    });

    const replayStore = {
      seen: vi.fn(async () => true), // Already seen
    };

    const configWithReplay = {
      ...baseConfig,
      allowReplay: true,
      replayStore,
    };

    const preHandler = agentPaywallFastify(configWithReplay);

    const mockRequest = {
      headers: {
        'x-payment-proof': 'replayed_signature',
      },
    };

    const mockReply = {
      code: vi.fn(function () {
        return this;
      }),
      header: vi.fn(function () {
        return this;
      }),
      send: vi.fn(),
    };

    await preHandler(mockRequest, mockReply as any);

    // Should verify even though signature was "already seen"
    expect(verifyMock).toHaveBeenCalled();
  });

  it('returns 402 when payment verification fails', async () => {
    const verifyMock = vi.mocked(verifyUSDCPayment);
    verifyMock.mockResolvedValueOnce({
      valid: false,
      error: 'Insufficient amount transferred',
      errorCode: 'INSUFFICIENT_AMOUNT',
      actualAmountUsdc: 0.0005,
    });

    const preHandler = agentPaywallFastify(baseConfig);

    const mockRequest = {
      headers: {
        'x-payment-proof': 'invalid_signature',
      },
    };

    const mockReply = {
      code: vi.fn(function () {
        return this;
      }),
      header: vi.fn(function () {
        return this;
      }),
      send: vi.fn(),
    };

    await preHandler(mockRequest, mockReply as any);

    expect(mockReply.code).toHaveBeenCalledWith(402);
    const sentPayload = mockReply.send.mock.calls[0][0];
    expect(sentPayload.verificationError).toBe('Insufficient amount transferred');
    expect(sentPayload.verificationErrorCode).toBe('INSUFFICIENT_AMOUNT');
  });

  it('passes request through with valid payment', async () => {
    const verifyMock = vi.mocked(verifyUSDCPayment);
    verifyMock.mockResolvedValueOnce({
      valid: true,
      actualAmountUsdc: 0.001,
      senderWallet: 'SenderWallet22222222222222222222222222222222',
    });

    const preHandler = agentPaywallFastify(baseConfig);

    const mockRequest = {
      headers: {
        'x-payment-proof': 'valid_signature',
      },
    };

    const mockReply = {
      code: vi.fn(function () {
        return this;
      }),
      header: vi.fn(function () {
        return this;
      }),
      send: vi.fn(),
    };

    await preHandler(mockRequest, mockReply as any);

    // Should NOT send a 402 or 403 response — handler continues to route
    expect(mockReply.send).not.toHaveBeenCalled();
  });

  it('calls onPaymentVerified callback when provided', async () => {
    const verifyMock = vi.mocked(verifyUSDCPayment);
    verifyMock.mockResolvedValueOnce({
      valid: true,
      actualAmountUsdc: 0.001,
      senderWallet: 'SenderWallet22222222222222222222222222222222',
    });

    const onPaymentVerified = vi.fn();

    const configWithCallback = {
      ...baseConfig,
      onPaymentVerified,
    };

    const preHandler = agentPaywallFastify(configWithCallback);

    const mockRequest = {
      headers: {
        'x-payment-proof': 'valid_signature',
      },
    };

    const mockReply = {
      code: vi.fn(function () {
        return this;
      }),
      header: vi.fn(function () {
        return this;
      }),
      send: vi.fn(),
    };

    await preHandler(mockRequest, mockReply as any);

    expect(onPaymentVerified).toHaveBeenCalledWith({
      signature: 'valid_signature',
      amountUsdc: 0.001,
      senderWallet: 'SenderWallet22222222222222222222222222222222',
    });
  });

  it('records transaction when platformApiKey is provided', async () => {
    const verifyMock = vi.mocked(verifyUSDCPayment);
    verifyMock.mockResolvedValueOnce({
      valid: true,
      actualAmountUsdc: 0.001,
      senderWallet: 'SenderWallet22222222222222222222222222222222',
    });

    const recordMock = vi.mocked(recordTransaction);

    const configWithRecording = {
      ...baseConfig,
      platformApiKey: 'test_api_key',
    };

    const preHandler = agentPaywallFastify(configWithRecording);

    const mockRequest = {
      headers: {
        'x-payment-proof': 'valid_signature',
      },
    };

    const mockReply = {
      code: vi.fn(function () {
        return this;
      }),
      header: vi.fn(function () {
        return this;
      }),
      send: vi.fn(),
    };

    await preHandler(mockRequest, mockReply as any);

    expect(recordMock).toHaveBeenCalledWith({
      txSignature: 'valid_signature',
      apiId: 'api_test',
      consumerWallet: 'SenderWallet22222222222222222222222222222222',
      amountUsdc: 0.001,
      platformApiKey: 'test_api_key',
    });
  });

  it('warns about multi-instance replay store when no custom store provided', () => {
    const warnMock = vi.mocked(maybeWarnAboutMultiInstanceReplay);

    agentPaywallFastify(baseConfig);

    expect(warnMock).toHaveBeenCalled();
  });

  it('does not warn about multi-instance when custom replay store provided', () => {
    const warnMock = vi.mocked(maybeWarnAboutMultiInstanceReplay);

    const customStore = {
      seen: vi.fn(async () => false),
    };

    agentPaywallFastify({
      ...baseConfig,
      replayStore: customStore,
    });

    expect(warnMock).not.toHaveBeenCalled();
  });
});
