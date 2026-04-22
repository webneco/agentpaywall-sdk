type RecordTransactionParams = {
  txSignature: string;
  apiId: string;
  consumerWallet: string;
  amountUsdc: number;
  platformApiKey: string;
  userAgent?: string;
};

/**
 * Records a verified payment transaction on the AgentPaywall platform.
 * Fire-and-forget: failures are intentionally ignored to avoid blocking API responses.
 */
export function recordTransaction(params: RecordTransactionParams): void {
  const platformApi =
    process.env.AGENTPAYWALL_PLATFORM_URL ?? 'https://agentpaywall.vercel.app';

  void fetch(`${platformApi}/api/transactions/record`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Platform-Api-Key': params.platformApiKey,
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    // Silent failure by design.
  });
}