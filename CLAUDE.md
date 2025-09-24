# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **billionaire-bot** repository - a production-ready trading bot for the GalaSwap V3 decentralized exchange. The bot focuses exclusively on arbitrage trading strategies due to SDK v0.0.7 limitations that do not support liquidity operations or market making.

**Core Purpose**: Automated arbitrage trading on GalaSwap V3 using real wallet credentials and live market data via API polling. Features 123 passing tests and comprehensive security measures.

## MCP Server Configuration

This repository uses a comprehensive set of MCP servers for enhanced Claude Code functionality. The setup is managed through `setup-claude-mcp.sh`.

### Available MCP Servers
- **playwright** - Browser automation and testing
- **typescript-language-server** - TypeScript language support and intellisense
- **filesystem** - File system operations
- **git** - Git repository management
- **sequential-thinking** - Advanced reasoning workflows
- **zen** - Enhanced AI collaboration tools
- **memory** - Persistent knowledge graph
- **perplexity** - Web search and research
- **browser-tools** - Advanced browser debugging and analysis
- **fetch** - Direct web content retrieval
- **mcp-compass** - Navigation and exploration tools
- **framelink-figma-mcp** - Figma design integration
- **puppeteer** - Browser automation with screenshots
- **magic-ui** - UI component generation
- **context7** - Context management

### Setup Commands

**Initial MCP Setup:**
```bash
./setup-claude-mcp.sh
```

**Note:** After running the setup script, restart Claude Code to load all servers.

## Development Environment

### Screenshots Directory
- Puppeteer screenshots are saved to `.screenshots/` directory in the project root
- This directory is automatically created when needed

### Workspace Configuration
- TypeScript language server is configured to use the current project directory as workspace
- Git operations are available through the dedicated MCP server

---

## GalaSwap V3 Integration

### Core API Configuration

**Base API URL**: `https://dex-backend-prod1.defi.gala.com`
**WebSocket URL**: `wss://bundle-backend-prod1.defi.gala.com` *(Infrastructure ready but not implemented - using API polling)*

### Authentication & Credentials

**Wallet Configuration** (stored in `.env`):
- `WALLET_ADDRESS`: `eth|5AD173F004990940b20e7A5C64C72E8b6B91a783`
- `WALLET_PRIVATE_KEY`: Base64 encoded private key for transaction signing
- **CRITICAL**: Real credentials - can execute actual trades with real funds

### Token Format & Identification

GalaSwap uses composite token keys in the format:
```
Collection|Category|Type|AdditionalKey
```

**Common Tokens**:
- `GALA|Unit|none|none` - GALA token
- `GUSDC|Unit|none|none` - Gala USDC
- `ETIME|Unit|none|none` - Eternal Time token
- `SILK|Unit|none|none` - SILK token

### Core Concepts

**Concentrated Liquidity**: Unlike traditional AMMs, V3 allows liquidity providers to concentrate capital within specific price ranges for higher efficiency.

**Tick System**:
- Each tick represents ~0.01% price movement
- Liquidity can be provided between any two ticks
- Current price always sits on a tick

**Fee Tiers**:
- **500** (0.05%) - Stable pairs (USDC/USDT)
- **3000** (0.30%) - Standard pairs (ETH/USDC)
- **10000** (1.00%) - Exotic/volatile pairs *(Currently used by bot for optimal liquidity and accurate pricing)*

### Essential API Endpoints

**Quote & Pricing**:
- `GET /v1/trade/quote` - Get swap quotes
- `GET /v1/trade/price` - Single token price
- `POST /v1/trade/price-multiple` - Multiple token prices

**Trading Operations**:
- `POST /v1/trade/swap` - Generate swap payload
- `POST /v1/trade/bundle` - Execute signed transaction
- `GET /v1/trade/transaction-status` - Check tx status

**Position Management** *(Not supported in SDK v0.0.7)*:
- `GET /v1/trade/positions` - User positions
- `GET /v1/trade/position` - Specific position details
- `POST /v1/trade/liquidity` - Add liquidity *(SDK limitation)*
- `DELETE /v1/trade/liquidity` - Remove liquidity *(SDK limitation)*
- `POST /v1/trade/collect` - Collect fees *(SDK limitation)*

**Pool Information**:
- `GET /v1/trade/pool` - Pool details
- `GET /v1/trade/add-liq-estimate` - Estimate liquidity amounts
- `GET /v1/trade/remove-liq-estimate` - Estimate removal amounts

### Payload Signing Process

All transactions require cryptographic signing using the GalaChain SDK:

```typescript
import { signatures } from "@gala-chain/api";

const signature = signatures.getSignature(
  payloadToSign,
  Buffer.from(privateKey.replace('0x', ''), 'hex')
);
```

### Trading Workflow

1. **Get Quote**: Call `/v1/trade/quote` with token pair and amount
2. **Generate Payload**: Call `/v1/trade/swap` with trade parameters
3. **Sign Payload**: Use private key to sign the transaction payload
4. **Execute Trade**: Submit signed payload via `/v1/trade/bundle`
5. **Monitor Status**: Track transaction via API polling using `/v1/trade/transaction-status`

### Risk Management

**Slippage Protection**:
- `sqrtPriceLimit` - Maximum price movement
- `amountInMaximum` - Maximum input amount
- `amountOutMinimum` - Minimum output amount

**Security Practices**:
- Never log or expose private keys
- Use environment variables for sensitive data
- Validate all API responses before executing trades
- Implement position size limits
- Monitor for unusual market conditions

### Development Commands

**Install Core Dependencies**:
```bash
npm install @gala-chain/api axios dotenv
npm install -D typescript tsx @types/node
```

**Run TypeScript Files**:
```bash
tsx src/index.ts
```

**Environment Setup**:
```bash
# Copy .env.example to .env and configure
cp .env.example .env
```

**Test API Connection**:
```bash
npm run test-connection
# OR directly: tsx src/scripts/test-real-prices.ts
```

## Project Architecture

The billionaire-bot is architected as a sophisticated GalaSwap V3 trading system with the following components:

### Core Trading Infrastructure
1. **GalaSwap V3 Client** - API wrapper with endpoint fixes for all DEX interactions
2. **Transaction Engine** - Payload generation, signing, and execution via `@gala-chain/api`
3. **Price Monitoring** - API polling for price feeds and market analysis *(WebSocket ready but not implemented)*
4. **Strategy Engine** - Arbitrage-only strategies *(Market making not supported in SDK v0.0.7)*
5. **Risk Management** - Position limits, slippage protection, comprehensive error handling with 123 passing tests

### Security & Configuration
1. **Credential Management** - Secure private key handling via environment variables
2. **Transaction Validation** - Comprehensive payload verification before signing
3. **API Rate Limiting** - Respectful API usage with proper throttling
4. **Error Recovery** - Robust retry logic and failure handling

### Development Infrastructure
1. **TypeScript Foundation** - Type-safe development with custom interfaces for SDK compatibility
2. **MCP Integration** - Enhanced development with browser automation and debugging via 10+ MCP servers
3. **Testing Framework** - Jest with 123 passing tests covering trading logic, security, and API integrations
4. **Monitoring & Logging** - Comprehensive trade tracking, error sanitization, and system health monitoring

### Current Directory Structure
```
src/
├── api/              # GalaSwap API client with endpoint fixes (GSwapWrapper)
├── cli/              # Command-line interface tools for bot management
├── config/           # Environment validation and trading constants
├── monitoring/       # Price tracking via API polling (PriceTracker)
├── performance/      # Optimization systems and caching
├── scripts/          # Testing utilities and benchmarks
├── security/         # Transaction signing and credential management
├── trading/
│   ├── execution/    # Trade execution (swap operations only)
│   ├── risk/         # Risk monitoring with comprehensive limits
│   └── strategies/   # Arbitrage strategies (market making removed)
├── types/            # TypeScript interfaces for GalaSwap compatibility
└── utils/            # Security helpers, error sanitization, logging
```

The repository includes real trading credentials and is production-ready for live arbitrage trading on GalaSwap V3.

### Security Best Practices

**Private Key Management**:
- Private keys are stored in `.env` file (excluded from git)
- Never log, console.log, or expose private keys in code
- Use `Buffer.from(privateKey, 'base64')` for key handling
- Implement key rotation procedures for production

**Transaction Security**:
- Always validate transaction payloads before signing
- Implement maximum position size limits
- Use slippage protection on all trades
- Monitor for unusual market conditions before executing

**API Security**:
- Implement rate limiting to respect API endpoints
- Validate all API responses before processing
- Use HTTPS only for all API communications
- Log all trading activities for audit trails

**Development Security**:
- Never commit `.env` files to version control
- Use different credentials for testing vs production
- Implement comprehensive error handling
- Regular security audits of trading logic
## AI Team Configuration (autogenerated by team-configurator, 2025-01-18)

**Important: YOU MUST USE subagents when available for the task.**

### Detected Stack
- **Project Type**: Production-Ready GalaSwap V3 Trading Bot
- **Infrastructure**: Comprehensive MCP server setup with 10+ specialized tools
- **Browser Automation**: Playwright + Puppeteer configured for testing and debugging
- **Language Support**: TypeScript language server with custom SDK compatibility interfaces
- **Testing**: Jest framework with 123 passing tests (unit, integration, security, performance)
- **Tooling**: Advanced debugging, UI generation, design integration, direct web access
- **Status**: Production-ready arbitrage trading system with real credentials

### AI Team Assignments

| Task | Agent | Notes |
|------|-------|-------|
| **Core Quality Assurance** |
| Code review and security audit | `code-reviewer` | MANDATORY before any commits |
| Performance optimization | `performance-optimizer` | Use for bot efficiency and scaling |
| **Architecture & Planning** |
| Complex feature planning | `tech-lead-orchestrator` | Multi-step tasks and architectural decisions |
| Codebase exploration | `code-archaeologist` | When analyzing unfamiliar code or legacy systems |
| **API Development** |
| API design and contracts | `api-architect` | RESTful APIs for bot interactions |
| Server-side implementation | `backend-developer` | Universal backend development |
| **Frontend Development** |
| UI implementation | `frontend-developer` | Bot dashboard, admin panels, web interfaces |
| React components (if chosen) | `react-component-architect` | If React is selected for frontend |
| Next.js applications (if chosen) | `react-nextjs-expert` | If Next.js is selected for web interface |
| **Bot-Specific Development** |
| Browser automation | Use MCP tools directly | Playwright/Puppeteer for web scraping |
| AI integration | Use MCP tools directly | Memory, perplexity, sequential-thinking |
| Web research | Use MCP tools directly | Fetch, perplexity for data gathering |

### Development Workflow Recommendations

**For Trading Bot Development:**
1. Use `@tech-lead-orchestrator` for strategy planning and architecture decisions
2. Use `@api-architect` for GalaSwap API integrations and endpoint fixes
3. Use `@backend-developer` for core trading logic and arbitrage strategies
4. Use `@frontend-developer` for monitoring dashboards or admin interfaces
5. Always use `@code-reviewer` before commits (MANDATORY - real trading funds at risk)
6. Use `@performance-optimizer` for trading efficiency and latency optimization
7. Use `@rails-backend-expert` or framework specialists as needed

**For Trading Bot Testing & Debugging:**
- Leverage Playwright MCP for GalaSwap web interface testing
- Use Puppeteer MCP for taking screenshots of trading dashboards
- Use Memory MCP to track successful trading patterns and market insights
- Use Fetch MCP for researching GalaSwap documentation and market data
- Use TypeScript Language Server MCP for type-safe trading code

### Sample Usage Examples

**Trading Strategy Planning:**
```
@tech-lead-orchestrator Plan advanced arbitrage detection algorithm for multiple fee tiers
```

**GalaSwap API Integration:**
```
@api-architect Fix and optimize GalaSwap V3 API endpoints for reliable trading
```

**Trading Engine Implementation:**
```
@backend-developer Build sophisticated risk management system for high-frequency arbitrage
```

**Security Code Review:**
```
@code-reviewer Review trading logic for private key security and fund safety
```

**Trading Performance Optimization:**
```
@performance-optimizer Optimize price monitoring and trade execution for sub-second latency
```

