import { describe, expect, it } from 'vitest';
import {
  build402Response,
  resolveRpcUrl,
  resolveUsdcMintAddress,
} from '../src/payment-response';
import type { AgentPaywallConfig } from '../src/types';

const baseConfig: AgentPaywallConfig = {
  priceUsdc: 0.001,
  recipientWallet: 'RecipientWallet1111111111111111111111111',
  apiId: 'api_test',
};

describe('resolveRpcUrl / resolveUsdcMintAddress', () => {
  it('defaults to devnet when network is unset and rpcUrl is unset', () => {
    expect(resolveRpcUrl(baseConfig)).toBe('https://api.devnet.solana.com');
    expect(resolveUsdcMintAddress(baseConfig)).toBe(
      '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    );
  });

  it('resolves to mainnet when network is mainnet-beta and rpcUrl is unset', () => {
    // Regression guard for CONFIG-NETWORK-MISMATCH: pre-0.3.0 the middleware
    // hard-coded DEVNET_RPC_URL here, so a dev declaring mainnet-beta without
    // an explicit rpcUrl would have the 402 response advertise mainnet while
    // the verifier hit devnet — every real mainnet payment rejected.
    const mainnetConfig: AgentPaywallConfig = {
      ...baseConfig,
      network: 'mainnet-beta',
    };
    expect(resolveRpcUrl(mainnetConfig)).toBe(
      'https://api.mainnet-beta.solana.com',
    );
    expect(resolveUsdcMintAddress(mainnetConfig)).toBe(
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    );
  });

  it('prefers an explicit rpcUrl over the network default', () => {
    const customConfig: AgentPaywallConfig = {
      ...baseConfig,
      network: 'mainnet-beta',
      rpcUrl: 'https://helius-custom.example.com/?api-key=X',
    };
    expect(resolveRpcUrl(customConfig)).toBe(
      'https://helius-custom.example.com/?api-key=X',
    );
  });

  it('prefers an explicit usdcMintAddress over the network default', () => {
    const customConfig: AgentPaywallConfig = {
      ...baseConfig,
      network: 'devnet',
      usdcMintAddress: 'SomeOtherMint111111111111111111111111111111',
    };
    expect(resolveUsdcMintAddress(customConfig)).toBe(
      'SomeOtherMint111111111111111111111111111111',
    );
  });

  it('build402Response advertises the same RPC URL and mint as the resolvers', () => {
    // The whole point of sharing these helpers: the 402 response clients see
    // and the URL/mint the verifier uses must agree.
    const mainnetConfig: AgentPaywallConfig = {
      ...baseConfig,
      network: 'mainnet-beta',
    };
    const response = build402Response(mainnetConfig);
    expect(response.paymentDetails.rpcUrl).toBe(resolveRpcUrl(mainnetConfig));
    expect(response.paymentDetails.usdcMintAddress).toBe(
      resolveUsdcMintAddress(mainnetConfig),
    );
  });
});
