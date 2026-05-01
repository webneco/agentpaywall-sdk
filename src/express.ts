import type { NextFunction, Request, Response } from 'express';
import {
  build402Response,
  resolveRpcUrl,
  resolveUsdcMintAddress,
} from './payment-response';
import { recordTransaction } from './recorder';
import {
  createInMemoryReplayStore,
  maybeWarnAboutMultiInstanceReplay,
} from './replay-store';
import type { AgentPaywallConfig, ReplayStore } from './types';
import { verifyUSDCPayment } from './verify';

// Module-level so every middleware instance in this process shares the same
// set of consumed signatures. Still process-local — supply config.replayStore
// on multi-instance deployments.
const defaultReplayStore: ReplayStore = createInMemoryReplayStore();

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
  const replayStore = config.replayStore ?? defaultReplayStore;
  if (!config.replayStore) maybeWarnAboutMultiInstanceReplay();

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

    // Atomic check-and-set inside the store. A signature is consumed the
    // moment it is first seen, regardless of whether verification later
    // succeeds or fails — never release it on failure, or an attacker can
    // race a transient RPC failure to double-accept one valid payment.
    if (
      config.allowReplay !== true &&
      (await replayStore.seen(paymentProof))
    ) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'REPLAY_DETECTED',
        message: 'Transaction signature has already been used',
      });
    }

    const result = await verifyUSDCPayment({
      txSignature: paymentProof,
      expectedRecipient: config.recipientWallet,
      expectedAmountUsdc: config.priceUsdc,
      rpcUrl: resolveRpcUrl(config),
      usdcMintAddress: resolveUsdcMintAddress(config),
      timeoutMs: config.verifyTimeout,
      maxTxAgeSeconds: config.maxTxAgeSeconds,
      onError: config.onError,
    });

    if (!result.valid) {
      return res.status(402).json({
        ...build402Response(config),
        verificationError: result.error,
        verificationErrorCode: result.errorCode,
      });
    }

    if (config.onPaymentVerified) {
      config.onPaymentVerified({
        signature: paymentProof,
        amountUsdc: result.actualAmountUsdc ?? config.priceUsdc,
        senderWallet: result.senderWallet,
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
