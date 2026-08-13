# Changelog

All notable changes to the @agentpaywall/sdk project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-08-13

### Added

- **Fastify Integration**: New `agentPaywallFastify()` preHandler for Fastify applications
  - Exported as both main export and via `@agentpaywall/sdk/fastify`
  - Supports all configuration options including custom replay stores and callbacks
  - Comprehensive test coverage for Fastify middleware

- **Complete Documentation**:
  - Full configuration table with all available options
  - Detailed API reference for all exported functions
  - New "Security & Best Practices" section covering:
    - Replay attack protection and multi-instance deployments
    - Transaction freshness validation
    - Token-2022 transfer fee handling
    - Custom RPC endpoint requirements

- **Enhanced Type Definitions**: Added `@types/fastify` to devDependencies for better type safety

- **Test Coverage**: Added comprehensive Fastify integration test suite (`test/fastify.test.ts`)

### Changed

- Simplified Fastify quick-start example in README (now uses `agentPaywallFastify()` hook)
- Updated README to include all configuration options with descriptions
- Improved API reference documentation with parameter details and usage examples

### Fixed

- Export path now includes Fastify module in `package.json` exports

## [0.2.0] - 2026-07-XX (Inferred)

### Added

- Core payment verification functionality
- Express and Next.js middleware implementations
- In-memory replay protection store
- Transaction recording to AgentPaywall dashboard

## [0.1.0] - 2026-06-XX (Inferred)

### Added

- Initial release of @agentpaywall/sdk
- Basic USDC payment verification on Solana
- Express middleware support
- Next.js App Router support
- Documentation and configuration

---

## How to Upgrade

### From 0.2.x to 0.3.0

If you're using Fastify, you can now use the simpler `agentPaywallFastify()` middleware:

**Before (0.2.x):**
```ts
fastify.addHook('preHandler', async (request, reply) => {
  const proof = request.headers['x-payment-proof'];
  // ... manual verification code
});
```

**After (0.3.0):**
```ts
import { agentPaywallFastify } from '@agentpaywall/sdk/fastify';

fastify.addHook('preHandler', agentPaywallFastify(config));
```

All other functionality remains backward compatible.

---

## Security Updates

### v0.3.0

- ✅ Improved documentation on replay attack prevention
- ✅ Added Fastify type definitions for better type safety
- ✅ Enhanced security section with best practices for multi-instance deployments
- ✅ Clear guidance on custom RPC endpoint handling

---

## Upcoming

- [ ] Automated CI/CD pipeline (GitHub Actions)
- [ ] Security audit documentation
- [ ] Example applications repository
- [ ] Support for Solana program instruction builders
- [ ] Analytics dashboard enhancements
