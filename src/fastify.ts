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

const defaultReplayStore: ReplayStore = createInMemoryReplayStore();

type FastifyRequest = {
  headers: Record<string, string | string[] | undefined>;
};

type FastifyReply = {
  code(statusCode: number): FastifyReply;
  header(name: string, value: string): FastifyReply;
  send(payload: unknown): void;
};

/**
 * Creates a Fastify preHandler that enforces USDC payment before allowing access to a route handler.
 */
export function agentPaywallFastify(config: AgentPaywallConfig) {
  const replayStore = config.replayStore ?? defaultReplayStore;
  if (!config.replayStore) maybeWarnAboutMultiInstanceReplay();

  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const proofHeader = req.headers['x-payment-proof'];
    const paymentProof =
      typeof proofHeader === 'string'
        ? proofHeader
        : Array.isArray(proofHeader)
          ? proofHeader[0]
          : undefined;

    if (!paymentProof) {
      reply
        .code(402)
        .header('Content-Type', 'application/json')
        .send(build402Response(config));
      return;
    }

    if (
      config.allowReplay !== true &&
      (await replayStore.seen(paymentProof))
    ) {
      reply.code(403).header('Content-Type', 'application/json').send({
        error: 'Forbidden',
        code: 'REPLAY_DETECTED',
        message: 'Transaction signature has already been used',
      });
      return;
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
      reply.code(402).header('Content-Type', 'application/json').send({
        ...build402Response(config),
        verificationError: result.error,
        verificationErrorCode: result.errorCode,
      });
      return;
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
      });
    }
  };
}
