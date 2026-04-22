import type { NextFunction, Request, Response } from 'express';
import { build402Response } from './payment-response';
import { recordTransaction } from './recorder';
import type { AgentPaywallConfig } from './types';
import { verifyUSDCPayment } from './verify';

const DEVNET_RPC_URL = 'https://api.devnet.solana.com';

type PaymentContext = {
  txSignature: string;
  amountUsdc?: number;
  senderWallet?: string;
};

type RequestWithPayment = Request & {
  payment?: PaymentContext;
};

/**
 * Creates Express middleware that enforces USDC payment before allowing access to an API handler.
 */
export function agentPaywall(config: AgentPaywallConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const paymentProofHeader = req.headers['x-payment-proof'];
    const paymentProof =
      typeof paymentProofHeader === 'string'
        ? paymentProofHeader
        : Array.isArray(paymentProofHeader)
          ? paymentProofHeader[0]
          : undefined;

    if (!paymentProof) {
      return res.status(402).json(build402Response(config));
    }

    const result = await verifyUSDCPayment({
      txSignature: paymentProof,
      expectedRecipient: config.recipientWallet,
      expectedAmountUsdc: config.priceUsdc,
      rpcUrl: config.rpcUrl ?? DEVNET_RPC_URL,
      usdcMintAddress: config.usdcMintAddress,
    });

    if (!result.valid) {
      return res.status(402).json({
        ...build402Response(config),
        verificationError: result.error,
      });
    }

    if (config.platformApiKey) {
      recordTransaction({
        txSignature: paymentProof,
        apiId: config.apiId,
        consumerWallet: result.senderWallet ?? 'unknown',
        amountUsdc: result.actualAmountUsdc ?? config.priceUsdc,
        platformApiKey: config.platformApiKey,
        userAgent:
          typeof req.headers['user-agent'] === 'string'
            ? req.headers['user-agent']
            : undefined,
      });
    }

    (req as RequestWithPayment).payment = {
      txSignature: paymentProof,
      amountUsdc: result.actualAmountUsdc,
      senderWallet: result.senderWallet,
    };

    return next();
  };
}