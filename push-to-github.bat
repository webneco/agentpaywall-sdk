@echo off
REM ========================================
REM  Push @agentpaywall/sdk to GitHub
REM  Run from: packages/sdk/
REM ========================================

echo [1/5] Initializing git repository...
git init

echo [2/5] Setting up remote...
git remote add origin https://github.com/webneco/agentpaywall-sdk.git

echo [3/5] Staging files...
git add .

echo [4/5] Creating initial commit...
git commit -m "feat: initial release of @agentpaywall/sdk v0.1.0

- Express middleware (agentPaywall)
- Next.js App Router wrapper (withAgentPaywall)
- On-chain USDC payment verification (verifyUSDCPayment)
- Standard 402 response builder (build402Response)
- Fire-and-forget transaction recording (recordTransaction)
- Full test suite with vitest"

echo [5/5] Pushing to GitHub...
git branch -M main
git push -u origin main

echo.
echo Done! Visit: https://github.com/webneco/agentpaywall-sdk
