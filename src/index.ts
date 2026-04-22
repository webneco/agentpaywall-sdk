export { agentPaywall } from './express';
export { withAgentPaywall } from './nextjs';
export { verifyUSDCPayment } from './verify';
export { build402Response } from './payment-response';
export { recordTransaction } from './recorder';
export type {
	AgentPaywallConfig,
	PaymentVerificationResult,
	Payment402Response,
} from './types';

export const version = '0.1.0';
