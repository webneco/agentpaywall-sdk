import type { ReplayStore } from './types';

const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * FIFO in-memory replay store. Insertion-ordered; on overflow the oldest
 * entry is evicted. Safe for single-process deployments only.
 *
 * Do NOT rely on this for serverless (Vercel, Lambda, Cloudflare Workers)
 * or multi-pod deployments — state is per-instance, so the same signature
 * can be accepted once per instance. Provide a shared store via
 * `AgentPaywallConfig.replayStore` for those environments.
 */
export function createInMemoryReplayStore(options?: {
  maxEntries?: number;
}): ReplayStore {
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const seen = new Set<string>();

  return {
    async seen(signature: string): Promise<boolean> {
      if (seen.has(signature)) return true;
      if (seen.size >= maxEntries) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      seen.add(signature);
      return false;
    },
  };
}

let warnedMultiInstance = false;

/**
 * Emits a one-time warning on runtimes where the default in-memory replay
 * store is known-unsafe (Vercel, AWS Lambda, Cloudflare). Called once at
 * middleware construction when no explicit replayStore was supplied.
 */
export function maybeWarnAboutMultiInstanceReplay(): void {
  if (warnedMultiInstance) return;
  if (typeof process === 'undefined') return;

  const env = process.env ?? {};
  const isServerless =
    env.VERCEL === '1' ||
    typeof env.AWS_LAMBDA_FUNCTION_NAME === 'string' ||
    env.CF_PAGES === '1' ||
    typeof env.CF_WORKER === 'string';

  if (!isServerless) return;

  warnedMultiInstance = true;
  // eslint-disable-next-line no-console
  console.warn(
    '[agentpaywall] Multi-instance runtime detected (Vercel/Lambda/Cloudflare) ' +
      'but no replayStore was configured. The default in-memory store does not ' +
      'share state across instances — the same transaction signature can be ' +
      'accepted once per running instance. For mainnet, pass a shared ' +
      'replayStore (Redis/Upstash/Durable Object) in AgentPaywallConfig.',
  );
}
