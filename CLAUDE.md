# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **billionaire-bot** repository - a sophisticated trading bot for the GalaSwap V3 decentralized exchange. The bot utilizes concentrated liquidity AMM protocols to execute automated trading strategies on the Gala ecosystem.

**Core Purpose**: Automated trading and arbitrage opportunities on GalaSwap V3 using real wallet credentials and live market data.

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
**WebSocket URL**: `wss://bundle-backend-prod1.defi.gala.com`

### Authentication & Credentials

**Wallet Configuration** (stored in `.env`):
- `WALLET_ADDRESS`: `eth|5AD173F004990940b20e7A5C64C72E8b6B91a783`
- `WALLET_PRIVATE_KEY`: Base64 encoded private key for transaction signing
- **CRITICAL**: Real credentials - can execute actual trades with real funds

### Token Format & Identification

GalaSwap uses composite token keys in the format:
```
Collection$Category$Type$AdditionalKey
```

**Common Tokens**:
- `GALA$Unit$none$none` - GALA token
- `GUSDC$Unit$none$none` - Gala USDC
- `ETIME$Unit$none$none` - Eternal Time token
- `SILK$Unit$none$none` - SILK token

### Core Concepts

**Concentrated Liquidity**: Unlike traditional AMMs, V3 allows liquidity providers to concentrate capital within specific price ranges for higher efficiency.

**Tick System**:
- Each tick represents ~0.01% price movement
- Liquidity can be provided between any two ticks
- Current price always sits on a tick

**Fee Tiers**:
- **500** (0.05%) - Stable pairs (USDC/USDT)
- **3000** (0.30%) - Standard pairs (ETH/USDC)
- **10000** (1.00%) - Exotic/volatile pairs

### Essential API Endpoints

**Quote & Pricing**:
- `GET /v1/trade/quote` - Get swap quotes
- `GET /v1/trade/price` - Single token price
- `POST /v1/trade/price-multiple` - Multiple token prices

**Trading Operations**:
- `POST /v1/trade/swap` - Generate swap payload
- `POST /v1/trade/bundle` - Execute signed transaction
- `GET /v1/trade/transaction-status` - Check tx status

**Position Management**:
- `GET /v1/trade/positions` - User positions
- `GET /v1/trade/position` - Specific position details
- `POST /v1/trade/liquidity` - Add liquidity
- `DELETE /v1/trade/liquidity` - Remove liquidity
- `POST /v1/trade/collect` - Collect fees

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
5. **Monitor Status**: Track transaction via WebSocket or `/v1/trade/transaction-status`

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
tsx scripts/test-connection.ts
```

## Project Architecture

The billionaire-bot is architected as a sophisticated GalaSwap V3 trading system with the following components:

### Core Trading Infrastructure
1. **GalaSwap V3 Client** - API wrapper for all DEX interactions
2. **Transaction Engine** - Payload generation, signing, and execution
3. **Price Monitoring** - Real-time price feeds and market analysis
4. **Strategy Engine** - Automated trading strategies and arbitrage detection
5. **Risk Management** - Position limits, slippage protection, error handling

### Security & Configuration
1. **Credential Management** - Secure private key handling via environment variables
2. **Transaction Validation** - Comprehensive payload verification before signing
3. **API Rate Limiting** - Respectful API usage with proper throttling
4. **Error Recovery** - Robust retry logic and failure handling

### Development Infrastructure
1. **TypeScript Foundation** - Type-safe development with full GalaSwap API types
2. **MCP Integration** - Enhanced development with browser automation and debugging
3. **Testing Framework** - Unit tests for trading logic and API integrations
4. **Monitoring & Logging** - Comprehensive trade tracking and system health monitoring

### Planned Directory Structure
```
src/
├── api/              # GalaSwap API client and types
├── config/           # Environment and configuration management
├── trading/          # Core trading strategies and execution
├── utils/            # Signing, formatting, and helper utilities
├── types/            # TypeScript interfaces for GalaSwap
└── monitoring/       # Price tracking and market analysis
```

The repository includes real trading credentials and is ready for live trading operations on GalaSwap V3.

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
- **Project Type**: Bot/Automation Application (early stage)
- **Infrastructure**: Comprehensive MCP server setup
- **Browser Automation**: Playwright + Puppeteer configured
- **Language Support**: TypeScript language server ready
- **Tooling**: Advanced debugging, UI generation, design integration
- **Status**: Fresh repository ready for initial development

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

**For Bot Development:**
1. Start with `@tech-lead-orchestrator` for feature planning
2. Use `@api-architect` for external API integrations
3. Use `@backend-developer` for core bot logic
4. Use `@frontend-developer` for any web interfaces
5. Always use `@code-reviewer` before commits
6. Use `@performance-optimizer` for scaling and efficiency

**For Browser Automation:**
- Leverage Playwright MCP for testing and UI automation
- Use Puppeteer MCP for screenshots and parallel automation
- Use Memory MCP to track successful automation patterns
- Use Fetch MCP for direct web content retrieval

### Sample Usage Examples

**Feature Planning:**
```
@tech-lead-orchestrator Plan a web scraping module for billionaire news tracking
```

**API Development:**
```
@api-architect Design REST API for bot configuration and status reporting
```

**Backend Implementation:**
```
@backend-developer Build the core news aggregation engine with TypeScript
```

**Code Quality:**
```
@code-reviewer Review the web scraping implementation for security and best practices
```

**Performance Optimization:**
```
@performance-optimizer Optimize the bot for handling 1000+ concurrent web requests
```

