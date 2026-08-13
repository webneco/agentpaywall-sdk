# @agentpaywall/sdk

[![npm version](https://img.shields.io/npm/v/@agentpaywall/sdk.svg)](https://www.npmjs.com/package/@agentpaywall/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

Drop-in micropayment middleware for APIs, settled in **USDC on Solana**.

Add two lines of code to any Express or Next.js API and start earning USDC per call - no billing system, no minimums, no chargebacks.

## How it works

```
Client calls API  ->  No payment?  ->  402 + payment instructions (JSON)
                  ->  Has proof?   ->  Verify on-chain  ->  200 + data
```

1. An unpaid request gets a `402 Payment Required` response with a JSON body containing the price, recipient wallet, and Solana RPC details.
2. The client (human or AI agent) sends USDC to the specified wallet on Solana.
3. The client retries the request with `X-Payment-Proof: <solana_tx_signature>`.
4. The middleware verifies the payment on-chain and forwards the request to your handler.

## Installation

```bash
npm install @agentpaywall/sdk @solana/web3.js @solana/spl-token
```

## Quick Start

### Express

```ts
import express from 'express';
import { agentPaywall } from '@agentpaywall/sdk';

const app = express();

app.get(
  '/api/data',
  agentPaywall({
    priceUsdc: 0.001,
    recipientWallet: 'YOUR_SOLANA_WALLET',
    apiId: 'your-api-id',
  }),
  (req, res) => {
    res.json({ data: 'premium content' });
  },
);

app.listen(3000);
```

### Next.js (App Router)

```ts
import { withAgentPaywall } from '@agentpaywall/sdk/nextjs';

const config = {
  priceUsdc: 0.001,
  recipientWallet: 'YOUR_SOLANA_WALLET',
  apiId: 'your-api-id',
};

export const GET = withAgentPaywall(config, async (request) => {
  return Response.json({ data: 'premium content' });
});
```

### Fastify

```ts
import Fastify from 'fastify';
import { agentPaywallFastify } from '@agentpaywall/sdk/fastify';

const config = {
  priceUsdc: 0.001,
  recipientWallet: 'YOUR_SOLANA_WALLET',
  apiId: 'your-api-id',
};

const fastify = Fastify();

fastify.addHook('preHandler', agentPaywallFastify(config));

fastify.get('/api/data', async () => {
  return { data: 'premium content' };
});

fastify.listen({ port: 3000 });
```

## Configuration

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `priceUsdc` | `number` | Yes | - | Price in USDC per API call (e.g. `0.001`) |
| `recipientWallet` | `string` | Yes | - | Solana wallet (base58) that receives USDC |
| `apiId` | `string` | Yes | - | API ID for tracking and analytics |
| `platformApiKey` | `string` | No | - | API key to report transactions to the dashboard |
| `rpcUrl` | `string` | No | devnet/mainnet | Solana RPC endpoint |
| `usdcMintAddress` | `string` | No | auto | USDC mint (auto-detected from RPC URL) |
| `network` | `'devnet' \| 'mainnet-beta'` | No | `'devnet'` | Solana network |
| `allowReplay` | `boolean` | No | `false` | Allow the same transaction signature to be used multiple times (security risk) |
| `replayStore` | `ReplayStore` | No | in-memory | Custom replay protection store (required for multi-instance deployments) |
| `onPaymentVerified` | `(tx: VerifiedPayment) => void` | No | - | Callback invoked when payment is successfully verified |
| `onError` | `(scope: string, error: unknown) => void` | No | - | Callback for logging/monitoring verification errors |
| `verifyTimeout` | `number` | No | `30000` | RPC verification timeout in milliseconds |
| `maxTxAgeSeconds` | `number` | No | `300` | Maximum age of Solana transaction in seconds (5 minutes) |

## API Reference

### `agentPaywall(config)`

Express middleware. Returns `402` for unpaid requests, verifies payment, then calls `next()`.

**Usage:**
```ts
app.use(agentPaywall(config));
```

### `withAgentPaywall(config, handler)`

Next.js App Router wrapper. Returns `402` for unpaid requests, verifies payment, then calls your handler.

**Usage:**
```ts
export const GET = withAgentPaywall(config, async (request) => {
  return Response.json({ data: 'premium content' });
});
```

### `agentPaywallFastify(config)`

Fastify preHandler hook. Returns `402` for unpaid requests, verifies payment, then continues to route handler.

**Usage:**
```ts
fastify.addHook('preHandler', agentPaywallFastify(config));
```

### `verifyUSDCPayment(params)`

Low-level verification function. Checks a Solana transaction for a USDC transfer matching the expected amount and recipient. Never throws - returns `{ valid: false, error }` on failure.

**Parameters:**
- `txSignature` (string) - Solana transaction signature to verify
- `expectedRecipient` (string) - Wallet address that should receive USDC
- `expectedAmountUsdc` (number) - USDC amount (decimal, e.g., `0.001`)
- `rpcUrl` (string) - Solana RPC endpoint
- `usdcMintAddress?` (string) - USDC token mint (auto-detected for public RPCs)
- `timeoutMs?` (number) - RPC request timeout (default: 30000ms)
- `maxTxAgeSeconds?` (number) - Maximum transaction age in seconds (default: 300s)
- `onError?` (callback) - Error callback for logging

**Returns:**
```ts
{
  valid: boolean;
  actualAmountUsdc?: number;
  senderWallet?: string;
  error?: string;
  errorCode?: VerificationErrorCode;
}
```

### `build402Response(config)`

Builds the standard 402 JSON response payload with payment instructions. Called automatically by middleware.

### `recordTransaction(params)`

Fire-and-forget function that reports verified payments to the AgentPaywall dashboard (optional).

### `createInMemoryReplayStore(options?)`

Creates an in-memory replay protection store. **For single-process deployments only.**

```ts
const store = createInMemoryReplayStore({ maxEntries: 10000 });
const config = { ...baseConfig, replayStore: store };
```

⚠️ **Multi-instance deployments (Vercel, Lambda, Cloudflare) MUST provide a shared store** (Redis, Durable Objects, etc.) to prevent double-spending.

## Security & Best Practices

### Replay Attack Protection

AgentPaywall prevents replay attacks where a single valid transaction could be reused across multiple requests:

- By default, each transaction signature can only be verified **once**
- The `replayStore` interface is pluggable — provide your own for multi-instance deployments
- Default in-memory store is safe for single-process only (Node.js apps)

**For Vercel/Serverless:** You MUST provide a shared replay store (Redis/Upstash recommended):

```ts
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const replayStore = {
  async seen(signature: string) {
    const exists = await redis.exists(signature);
    if (!exists) {
      await redis.setex(signature, 3600, '1'); // 1-hour TTL
    }
    return !!exists;
  },
};

const config = {
  ...baseConfig,
  replayStore,
};
```

### Transaction Freshness

Transactions older than `maxTxAgeSeconds` (default: 300 seconds / 5 minutes) are rejected:

- Defends against old replayed signatures being discovered
- Provides a time window for legitimate payment confirmations
- Customize based on your UX requirements

```ts
const config = {
  ...baseConfig,
  maxTxAgeSeconds: 600, // 10 minutes
};
```

### Token-2022 Transfer Fees

AgentPaywall correctly handles Solana's Token-2022 extension (transfer fees):

- Verification uses **balance deltas**, not instruction `amount` fields
- Receiver's actual credit is what matters, not what was sent
- This prevents attackers from circumventing verification via transfer-fee extensions

### Custom RPC Endpoints

For authenticated or private RPC endpoints, **you must provide `usdcMintAddress` explicitly**:

```ts
const config = {
  priceUsdc: 0.001,
  recipientWallet: 'YOUR_WALLET',
  apiId: 'your-api-id',
  rpcUrl: 'https://helius.rpcpool.com/?api-key=YOUR_KEY', // Custom RPC
  usdcMintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Explicit on mainnet
};
```

The library only auto-detects USDC mint for Solana's public RPC hosts (security-first design).

## 402 Response Format

```json
{
  "error": "Payment Required",
  "code": "PAYMENT_REQUIRED",
  "paymentDetails": {
    "network": "solana",
    "currency": "USDC",
    "amount": 0.001,
    "recipient": "YOUR_WALLET",
    "memo": "your-api-id",
    "usdcMintAddress": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    "rpcUrl": "https://api.devnet.solana.com"
  },
  "instructions": "Send exactly 0.001 USDC on Solana to YOUR_WALLET...",
  "example": {
    "header": "X-Payment-Proof",
    "value": "<solana_transaction_signature>",
    "description": "Add the Solana transaction signature as a header after payment"
  }
}
```

## Why AgentPaywall?

| | Traditional Billing | AgentPaywall |
|---|---|---|
| **Setup** | Stripe account, webhooks, invoicing | 2 lines of middleware |
| **Minimums** | $0.50+ per charge | $0.000001 (6 decimal USDC) |
| **Fees** | 2.9% + $0.30 | ~$0.00025/tx (Solana fee) |
| **Chargebacks** | Yes | Impossible (on-chain) |
| **AI agents** | Can't sign up for Stripe | Parse JSON, pay, retry |
| **Settlement** | Days/weeks | ~400ms |
| **KYC** | Required | Permissionless |

## Dashboard

Track earnings, API calls, and transactions in real time at [agentpaywall.vercel.app](https://agentpaywall.vercel.app).

## License

[MIT](LICENSE)
