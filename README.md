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
import { verifyUSDCPayment, build402Response } from '@agentpaywall/sdk';

const config = {
  priceUsdc: 0.001,
  recipientWallet: 'YOUR_SOLANA_WALLET',
  apiId: 'your-api-id',
};

const fastify = Fastify();

fastify.addHook('preHandler', async (request, reply) => {
  const proof = request.headers['x-payment-proof'];
  if (!proof) {
    return reply.status(402).send(build402Response(config));
  }

  const result = await verifyUSDCPayment({
    txSignature: proof as string,
    expectedRecipient: config.recipientWallet,
    expectedAmountUsdc: config.priceUsdc,
    rpcUrl: 'https://api.devnet.solana.com',
  });

  if (!result.valid) {
    return reply.status(402).send({
      ...build402Response(config),
      verificationError: result.error,
    });
  }
});

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
| `rpcUrl` | `string` | No | devnet | Solana RPC endpoint |
| `usdcMintAddress` | `string` | No | auto | USDC mint (auto-detected from RPC URL) |
| `network` | `'devnet' \| 'mainnet-beta'` | No | `'devnet'` | Solana network |

## API Reference

### `agentPaywall(config)`

Express middleware. Returns `402` for unpaid requests, verifies payment, then calls `next()`.

### `withAgentPaywall(config, handler)`

Next.js App Router wrapper. Returns `402` for unpaid requests, verifies payment, then calls your handler.

### `verifyUSDCPayment(params)`

Low-level verification function. Checks a Solana transaction for a USDC transfer matching the expected amount and recipient. Never throws - returns `{ valid: false, error }` on failure.

### `build402Response(config)`

Builds the standard 402 JSON response payload with payment instructions.

### `recordTransaction(params)`

Fire-and-forget function that reports verified payments to the AgentPaywall dashboard.

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
