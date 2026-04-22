import type { AgentPaywallConfig, Payment402Response } from './types';

const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const DEVNET_RPC_URL = 'https://api.devnet.solana.com';
const MAINNET_RPC_URL = 'https://api.mainnet-beta.solana.com';

function getDefaultRpcUrl(config: AgentPaywallConfig): string {
  if (config.rpcUrl) {
    return config.rpcUrl;
  }

  return config.network === 'mainnet-beta' ? MAINNET_RPC_URL : DEVNET_RPC_URL;
}

function getDefaultUsdcMintAddress(config: AgentPaywallConfig): string {
  if (config.usdcMintAddress) {
    return config.usdcMintAddress;
  }

  return config.network === 'mainnet-beta' ? MAINNET_USDC : DEVNET_USDC;
}

/**
 * Builds a standard HTTP 402 response payload with payment instructions for the client.
 */
export function build402Response(config: AgentPaywallConfig): Payment402Response {
  const rpcUrl = getDefaultRpcUrl(config);
  const usdcMintAddress = getDefaultUsdcMintAddress(config);

  return {
    error: 'Payment Required',
    code: 'PAYMENT_REQUIRED',
    paymentDetails: {
      network: 'solana',
      currency: 'USDC',
      amount: config.priceUsdc,
      recipient: config.recipientWallet,
      memo: config.apiId,
      usdcMintAddress,
      rpcUrl,
    },
    instructions: `Send exactly ${config.priceUsdc} USDC on Solana to ${config.recipientWallet} with memo "${config.apiId}". Then retry your request with header: X-Payment-Proof: <your_transaction_signature>`,
    example: {
      header: 'X-Payment-Proof',
      value: '<solana_transaction_signature>',
      description:
        'Add the Solana transaction signature as a header after payment',
    },
  };
}