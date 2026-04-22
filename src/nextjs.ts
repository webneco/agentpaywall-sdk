import { build402Response } from './payment-response';
import { recordTransaction } from './recorder';
import type { AgentPaywallConfig } from './types';
import { verifyUSDCPayment } from './verify';

type NextHandler = (request: Request) => Promise<Response>;

const DEVNET_RPC_URL = 'https://api.devnet.solana.com';

/**
 * Wraps a Next.js App Router route handler with AgentPaywall payment enforcement.
 */
export function withAgentPaywall(
  config: AgentPaywallConfig,
  handler: NextHandler,
) {
  return async (request: Request): Promise<Response> => {
    const paymentProof = request.headers.get('x-payment-proof') ?? undefined;

    if (!paymentProof) {
      return Response.json(build402Response(config), { status: 402 });
    }

    const result = await verifyUSDCPayment({
      txSignature: paymentProof,
      expectedRecipient: config.recipientWallet,
      expectedAmountUsdc: config.priceUsdc,
      rpcUrl: config.rpcUrl ?? DEVNET_RPC_URL,
      usdcMintAddress: config.usdcMintAddress,
    });

    if (!result.valid) {
      return Response.json(
        {
          ...build402Response(config),
          verificationError: result.error,
        },
        { status: 402 },
      );
    }

    if (config.platformApiKey) {
      recordTransaction({
        txSignature: paymentProof,
        apiId: config.apiId,
        consumerWallet: result.senderWallet ?? 'unknown',
        amountUsdc: result.actualAmountUsdc ?? config.priceUsdc,
        platformApiKey: config.platformApiKey,
        userAgent: request.headers.get('user-agent') ?? undefined,
      });
    }

    return handler(request);
  };
}

export type { NextHandler };