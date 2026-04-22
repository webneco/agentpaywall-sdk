export interface AgentPaywallConfig {
  priceUsdc: number;
  recipientWallet: string;
  apiId: string;
  platformApiKey?: string;
  rpcUrl?: string;
  usdcMintAddress?: string;
  network?: 'devnet' | 'mainnet-beta';
}

export interface PaymentVerificationResult {
  valid: boolean;
  actualAmountUsdc?: number;
  senderWallet?: string;
  error?: string;
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