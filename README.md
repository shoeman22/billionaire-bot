# 🤖 Billionaire Bot - Advanced GalaSwap V3 Trading Bot

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Jest](https://img.shields.io/badge/Jest-C21325?style=for-the-badge&logo=jest&logoColor=white)](https://jestjs.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

A sophisticated automated trading bot for GalaSwap V3 with arbitrage detection and advanced risk management.

> ⚠️ **Disclaimer**: This software is for educational purposes. Use at your own risk. Trading cryptocurrencies involves substantial risk of loss.

## 🌟 Features

- **🔍 Arbitrage Detection**: Automatically finds and executes profitable arbitrage opportunities across different fee tiers
- **⚡ High-Performance Trading**: Optimized execution with intelligent caching and parallel processing
- **🛡️ Advanced Risk Management**: Portfolio limits, drawdown protection, and emergency stops
- **📊 Real-time Monitoring**: Price tracking via API polling for accurate market data
- **🔒 Security First**: Comprehensive input validation, error sanitization, and secure credential handling
- **🧪 Comprehensive Testing**: Full test suite with 123 passing tests covering all components
- **🐳 Production Ready**: Docker deployment with health checks and resource management

## 🚀 Getting Started

### 1. **Install Dependencies**
```bash
npm install
```

### 2. **Configure Environment**
Copy the example environment file and configure your credentials:
```bash
cp .env.example .env
```

Edit `.env` and add your GalaChain wallet information:
```bash
# Required: Your wallet details
WALLET_ADDRESS=eth|YOUR_ACTUAL_WALLET_ADDRESS
WALLET_PRIVATE_KEY=YOUR_BASE64_ENCODED_PRIVATE_KEY

# API endpoints (pre-configured for production)
GALASWAP_API_URL=https://dex-backend-prod1.defi.gala.com
GALASWAP_WS_URL=wss://bundle-backend-prod1.defi.gala.com

# Trading limits (adjust as needed)
MAX_POSITION_SIZE=1000
DEFAULT_SLIPPAGE_TOLERANCE=0.01
MIN_PROFIT_THRESHOLD=0.001
```

### 3. **Test Your Configuration**
Before starting, verify everything is configured correctly:
```bash
npm run test-connection
```
This will:
- ✅ Validate your environment configuration
- ✅ Test GalaSwap API connectivity
- ✅ Verify wallet configuration
- ✅ Test real price data retrieval

### 4. **Start the Bot**

**Development Mode (recommended for testing):**
```bash
npm run dev
```

**Dry-Run Mode (simulates trades without executing):**
```bash
npm run dev -- --dry-run
```

**Production Mode:**
```bash
npm run build
npm start
```

## 🐳 Docker Deployment

### Quick Start with Docker

1. **Build the image:**
```bash
npm run docker:build
```

2. **Run with Docker Compose:**
```bash
npm run docker:compose
```

3. **View logs:**
```bash
npm run docker:logs
```

4. **Stop the bot:**
```bash
npm run docker:down
```

### Docker Configuration

The Docker setup includes:
- Multi-stage build for minimal image size (Node.js 20 Alpine)
- Non-root user for security
- Health checks for container monitoring
- Resource limits to prevent runaway processes
- Named volumes for logs and data persistence
- Dumb-init for proper signal handling

### Docker Commands

```bash
npm run docker:build       # Build Docker image
npm run docker:run         # Run container with .env file
npm run docker:compose     # Start with docker-compose
npm run docker:down        # Stop all containers
npm run docker:logs        # View bot logs
npm run docker:shell       # Access container shell
npm run docker:clean       # Clean up Docker resources
```

## 📋 Available Commands

### Core Bot Operations
```bash
npm run dev                 # Start in development mode
npm run dev -- --dry-run   # Start in dry-run mode (no real trades)
npm start                   # Start in production mode
npm run test-connection     # Test API and wallet configuration
```

### Portfolio Management
```bash
npm run portfolio          # View current portfolio
npm run manual-trade       # Execute manual trades
# Example: npm run manual-trade -- -i GALA -o USDC -a 100 -s 1
```

### Advanced CLI Commands
```bash
tsx src/cli/trading-cli.ts auto-trade          # Start automated trading
tsx src/cli/trading-cli.ts auto-trade -- -d 120  # Auto-trade for 120 minutes
tsx src/cli/trading-cli.ts status              # Get current bot status
tsx src/cli/trading-cli.ts export              # Export trading data to CSV
tsx src/cli/trading-cli.ts export -- -t performance  # Export performance data
```

### Performance Monitoring
```bash
npm run performance:benchmark    # Run performance tests
npm run performance:optimize     # Optimize performance
npm run performance:all         # Full performance suite
```

### Testing & Quality
```bash
npm test                    # Run all tests
npm run test:integration    # Integration tests
npm run test:risk          # Risk management tests
npm run test:security       # Security tests
npm run test:coverage       # Generate coverage report
npm run lint               # Check code style
npm run typecheck          # TypeScript validation
tsx src/scripts/test-risk-management.ts  # Test risk management system
```

## 🎯 Trading Strategies

### Arbitrage Strategy
- Scans multiple fee tiers (0.05%, 0.30%, 1.00%) for price differences
- Calculates optimal trade sizes to maximize profit
- Executes trades with minimal slippage impact
- Monitors gas costs and net profitability
- Currently uses fee tier 10000 (1.00%) for optimal liquidity and accurate pricing

> **Note**: Market making and liquidity operations are not supported in SDK v0.0.7. The bot focuses exclusively on arbitrage trading.

## 🛡️ Risk Management

### Portfolio Protection
- **Maximum daily loss limits** - Stops trading if daily losses exceed threshold
- **Total portfolio limits** - Emergency stops for severe drawdowns
- **Position concentration limits** - Prevents over-exposure to single tokens
- **Volume limits** - Controls maximum daily trading volume

### Emergency Controls
- **Circuit breakers** for unusual market conditions
- **Automatic position closure** during high volatility
- **Manual override controls** for immediate shutdown
- **Graceful shutdown** with position unwinding

## 📊 Monitoring & Alerts

The bot provides real-time monitoring of:
- 💱 **Trade Execution**: All trades with transaction IDs and outcomes
- 📈 **Arbitrage Opportunities**: Detected opportunities and profitability
- 💹 **Portfolio Tracking**: Portfolio value and P&L monitoring
- ⚠️ **Risk Alerts**: Portfolio limits and emergency triggers
- 🔧 **Performance Metrics**: Latency, success rates, and optimization stats

## 🏗️ Architecture

```
src/
├── api/                    # GalaSwap API client and types
├── cli/                    # Command-line interface tools
├── config/                 # Environment and configuration
├── monitoring/             # Price tracking and market analysis
├── performance/            # Optimization and caching systems
├── scripts/                # Utility scripts for testing and benchmarks
├── security/               # Signing and security services
├── trading/
│   ├── execution/          # Trade execution (swap operations only)
│   ├── risk/              # Risk monitoring and emergency controls
│   └── strategies/         # Arbitrage strategies
├── types/                  # TypeScript type definitions
└── utils/                  # Utilities and helpers
```

## 🔒 Security

- **SignerService** for secure transaction signing with private key isolation
- **Input validation** on all user inputs and API responses
- **Path traversal protection** against directory access attacks
- **Rate limiting** with adaptive throttling to prevent API abuse
- **Secure credential handling** with environment variables and key rotation support
- **Secure random generation** for transaction IDs and security tokens
- **Error boundary protection** to prevent crashes and information leakage
- **Audit logging** for all trading activities with tamper-resistant records

## 🧪 Testing

Comprehensive test suite covering:
- **Unit tests** for all core components
- **Integration tests** for API interactions
- **Risk management tests** for safety systems
- **Performance tests** for optimization validation
- **Security tests** for vulnerability scanning

Run tests:
```bash
npm test                    # All tests
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests
npm run test:coverage      # With coverage report
```

## 📝 Configuration Options

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `WALLET_ADDRESS` | Your GalaChain wallet address | Required |
| `WALLET_PRIVATE_KEY` | Base64 encoded private key | Required |
| `GALASWAP_API_URL` | GalaSwap API endpoint | Production URL |
| `GALASWAP_WS_URL` | WebSocket endpoint | Production WS |
| `MAX_POSITION_SIZE` | Maximum position size in USD | 1000 |
| `DEFAULT_SLIPPAGE_TOLERANCE` | Default slippage tolerance | 0.01 (1%) |
| `MIN_PROFIT_THRESHOLD` | Minimum profit threshold | 0.001 (0.1%) |
| `NODE_ENV` | Environment mode | development |
| `LOG_LEVEL` | Logging level | debug |
| `ENABLE_PERFORMANCE_MODE` | Enable optimized trading engine | false |
| `CACHE_TTL_MS` | Price cache time-to-live | 5000 |
| `MAX_PARALLEL_REQUESTS` | Maximum concurrent API requests | 5 |
| `EMERGENCY_STOP_ENABLED` | Enable emergency stop controls | true |

### Risk Management Limits

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MAX_DAILY_LOSS_PERCENT` | 5% | Maximum daily portfolio loss |
| `MAX_TOTAL_LOSS_PERCENT` | 15% | Maximum total portfolio loss |
| `MAX_DRAWDOWN_PERCENT` | 10% | Maximum drawdown threshold |
| `MAX_DAILY_VOLUME` | $5,000 | Maximum daily trading volume |
| `MAX_POSITION_AGE_HOURS` | 24 | Maximum position hold time |

## 🚨 Safety Features

### Dry-Run Mode
Test the bot without executing real trades:
```bash
npm run dev -- --dry-run
```

### Emergency Shutdown
Stop the bot safely with graceful position closure:
```bash
Ctrl+C  # Graceful shutdown
```

### Risk Monitoring
The bot automatically:
- Monitors portfolio value and P&L
- Tracks daily trading volume
- Alerts on risk limit breaches
- Executes emergency stops when needed

## ⚠️ Current Limitations

- **No Liquidity Operations**: SDK v0.0.7 does not support adding/removing liquidity or market making
- **No WebSocket Implementation**: Currently uses API polling for price updates (WebSocket infrastructure ready)
- **Limited to Swap Operations**: Only token swapping is supported, no position management
- **No Historical Data**: Cannot analyze past performance trends or backtest strategies
- **Single Wallet Only**: Multi-wallet management not implemented
- **No Cross-Chain Support**: Limited to GalaChain ecosystem only

## 📈 Performance

### Optimization Features
- **OptimizedTradingEngine** with fast-path execution and batch processing
- **OptimizedRiskMonitor** with cached portfolio tracking and parallel monitoring
- **PerformanceOptimizer** with automatic optimization cycles and memory management
- **PriceCache** with volatility-aware TTL and intelligent invalidation
- **Intelligent caching** for price data and API responses
- **Parallel processing** for multi-token operations with request pooling
- **Connection pooling** for API requests
- **Memory management** with automatic cleanup and garbage collection

### Benchmarking
```bash
npm run performance:benchmark    # Measure current performance
npm run performance:optimize     # Apply optimizations
```

## 🤝 Contributing

We welcome contributions to improve the Billionaire Bot! Here's how you can help:

### Development Setup
1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/billionaire-bot.git`
3. Install dependencies: `npm install`
4. Create a feature branch: `git checkout -b feature/your-feature-name`
5. Make your changes and add tests
6. Ensure all tests pass: `npm test`
7. Run type checking: `npm run typecheck`
8. Run linting: `npm run lint`
9. Submit a pull request

### Code Style
- Use TypeScript for all new code
- Follow existing patterns and conventions
- Add comprehensive tests for new features
- Include JSDoc comments for public APIs
- Follow security best practices

### Areas for Contribution
- Additional trading strategies
- Enhanced market analysis
- Performance optimizations
- Documentation improvements
- Test coverage expansion

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This trading bot is for educational purposes only. Cryptocurrency trading involves substantial risk of loss. Past performance does not guarantee future results. Always do your own research and never invest more than you can afford to lose.

## 🔧 Troubleshooting

### Common Issues

**"Cannot find GSwap SDK"**
- Ensure @gala-chain/gswap-sdk is installed: `npm install @gala-chain/gswap-sdk@0.0.7`
- Verify Node.js version is 18+ and npm dependencies are installed

**"Invalid signature" errors**
- Verify your private key is base64 encoded (not hex)
- Check wallet address format: `eth|0x...`
- Ensure private key matches the wallet address

**"Insufficient liquidity" warnings**
- Reduce trade size or adjust slippage tolerance
- Check pool liquidity before large trades: `npm run test-connection`
- Consider using different fee tiers (500, 3000, 10000)

**Performance issues**
- Enable performance mode: `ENABLE_PERFORMANCE_MODE=true`
- Increase cache TTL for stable tokens: `CACHE_TTL_MS=15000`
- Run optimization: `npm run performance:optimize`
- Monitor memory usage: `npm run performance:memory`

**API connection failures**
- Check API endpoint configuration in `.env`
- Verify network connectivity to GalaSwap servers
- Run connection test: `npm run test-connection`
- Check rate limiting: reduce `MAX_PARALLEL_REQUESTS`

## 🆘 Support

- Review the logs for detailed error information
- Run diagnostics: `npm run test-connection`
- Check configuration: Ensure `.env` file is properly configured
- Verify wallet balance and permissions
- Monitor risk limits and emergency stops

---

**Made with ❤️ for the GalaChain ecosystem**