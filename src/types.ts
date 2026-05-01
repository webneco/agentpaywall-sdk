export interface VerifiedPayment {
  signature: string;
  amountUsdc: number;
  senderWallet?: string;
}

export type VerificationErrorCode =
  | 'MISSING_SIGNATURE'
  | 'INVALID_REQUEST'
  | 'TX_NOT_FOUND'
  | 'TX_FAILED'
  | 'TX_TOO_OLD'
  | 'TX_TIME_UNAVAILABLE'
  | 'NO_USDC_TRANSFER'
  | 'WRONG_RECIPIENT'
  | 'INSUFFICIENT_AMOUNT'
  | 'RPC_UNAVAILABLE'
  | 'INTERNAL_ERROR';

/**
 * Pluggable store for replay protection. Implementations MUST provide an
 * atomic check-and-set: `seen(signature)` returns `true` iff the signature
 * was already recorded by a previous call, and atomically records it
 * otherwise. There is no `forget` — once a signature is recorded it is
 * consumed, full stop.
 *
 * The default in-memory implementation is only safe for single-process
 * deployments. On serverless (Vercel, Lambda, Cloudflare Workers) or any
 * multi-instance deployment you MUST supply a shared store (Redis/Upstash,
 * Durable Object, etc.) — otherwise the same signature can be accepted
 * once per running instance.
 */
export interface ReplayStore {
  seen(signature: string): Promise<boolean>;
}

export interface AgentPaywallConfig {
  priceUsdc: number;
  recipientWallet: string;
  apiId: string;
  platformApiKey?: string;
  rpcUrl?: string;
  usdcMintAddress?: string;
  network?: 'devnet' | 'mainnet-beta';
  verifyTimeout?: number;
  maxTxAgeSeconds?: number;
  allowReplay?: boolean;
  replayStore?: ReplayStore;
  onPaymentVerified?: (tx: VerifiedPayment) => void;
  onError?: (scope: string, error: unknown) => void;
}

export interface PaymentVerificationResult {
  valid: boolean;
  actualAmountUsdc?: number;
  senderWallet?: string;
  error?: string;
  errorCode?: VerificationErrorCode;
}

export interface Payment402Response {
  error: 'Payment Required';
  code: 'PAYMENT_REQUIRED';
  paymentDetails: {
    network: 'solana';
    currency: 'USDC';
    amount: number;
    recipient: string;
    memo: string;
    usdcMintAddress: string;
    rpcUrl: string;
  };
  instructions: string;
  example: {
    header: string;
    value: string;
    description: string;
  };
}
