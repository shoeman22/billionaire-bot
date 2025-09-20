# Getting Started with GalaSwap V3 Protocol

Welcome to **GalaSwap V3**! This guide covers the core concepts of the V3 swapping protocol and how to use its APIs. Whether you're a developer or a trader, this doc will help you get productive fast.

**Base URL for all API requests:**  
`https://dex-backend-prod1.defi.gala.com`

---

## Table of Contents

- [Core Concepts](#core-concepts)
  - [Concentrated Liquidity](#concentrated-liquidity)
  - [Price Ranges and Ticks](#price-ranges-and-ticks)
  - [Fee Tiers](#fee-tiers)
  - [Token Format](#token-format)
- [Basic Operations](#basic-operations)
  - [Getting a Quote](#getting-a-quote)
  - [Checking Prices](#checking-prices)
  - [Understanding Positions](#understanding-positions)
- [Best Practices](#best-practices)
- [Common Use Cases](#common-use-cases)
- [Price Oracle APIs](#price-oracle-apis)
  - [Subscribe to Token Price Updates](#subscribe-to-token-price-updates)
  - [Fetch Historical Price Data (GET)](#fetch-historical-price-data-get)
  - [Fetch Historical Price Data (POST)](#fetch-historical-price-data-post)
- [Trading API Reference](#trading-api-reference)
  - [/v1/trade/quote (GET)](#v1tradequote-get)
  - [/v1/trade/add-liq-estimate (GET)](#v1tradeadd-liq-estimate-get)
  - [/v1/trade/remove-liq-estimate (GET)](#v1traderemove-liq-estimate-get)
  - [/v1/trade/price (GET)](#v1tradeprice-get)
  - [/v1/trade/price-multiple (POST)](#v1tradeprice-multiple-post)
  - [/v1/trade/position (GET)](#v1tradeposition-get)
  - [/v1/trade/positions (GET)](#v1tradepositions-get)
  - [/v1/trade/pool (GET)](#v1tradepool-get)
- [Payload Generation API Reference](#payload-generation-api-reference)
  - [/v1/trade/swap (POST)](#v1tradeswap-post)
  - [/v1/trade/collect (POST)](#v1tradecollect-post)
  - [/v1/trade/liquidity (POST add, DELETE remove)](#v1tradiliquidity-post-add-delete-remove)
  - [/v1/trade/create-pool (POST)](#v1tradecreate-pool-post)
- [Bundle & Execution](#bundle--execution)
  - [/v1/trade/bundle (POST)](#v1tradebundle-post)
  - [/v1/trade/transaction-status (GET)](#v1tradetransaction-status-get)
  - [WebSocket Events](#websocket-events)
- [Bridging API Reference](#bridging-api-reference)
  - [/v1/connect/bridge-configurations (GET)](#v1connectbridge-configurations-get)
  - [/v1/connect/bridge/request (POST)](#v1connectbridgerequest-post)
  - [/v1/connect/RequestTokenBridgeOut (POST)](#v1connectrequesttokenbridgeout-post)
  - [/v1/connect/BridgeTokenOut (POST)](#v1connectbridgetokenout-post)
  - [/v1/connect/bridge/status (POST)](#v1connectbridgestatus-post)
- [Payload Signing](#payload-signing)
  - [Signing with the GalaChain Node.js SDK](#signing-with-the-galachain-nodejs-sdk)
  - [Reference: Manual Signing Utilities](#reference-manual-signing-utilities)
- [Bridging Guides & Code Samples](#bridging-guides--code-samples)
  - [Ethereum → GalaChain](#ethereum--galachain)
  - [GalaChain → Other Chains](#galachain--other-chains)
  - [Solana → GalaChain](#solana--galachain)

---

## Core Concepts

### Concentrated Liquidity
Unlike traditional AMMs, V3 lets LPs concentrate capital within **specific price ranges**, enabling:
- More efficient use of capital
- Higher potential returns for LPs
- Better price execution for traders

### Price Ranges and Ticks
V3 uses a **tick-based** system to manage price ranges:
- Each tick represents ~**0.01%** price movement
- Liquidity can be provided **between any two ticks**
- The **current price always sits on a tick**
- Ticks are used to calculate **fees** and **track positions**

### Fee Tiers
Choose the tier that fits the pair’s volatility:

| Tier | Percent | Typical Use Case               |
|-----:|:-------:|--------------------------------|
|  500 | 0.05%   | Stable pairs (e.g., USDC/USDT) |
| 3000 | 0.30%   | Standard pairs (e.g., ETH/USDC)|
|10000 | 1.00%   | Exotic/volatile pairs          |

### Token Format
Tokens are identified via a **composite key**:  
`Collection$Category$Type$AdditionalKey`

Example: `"GALA$Unit$none$none"`
- **Collection**: Token collection/name (`GALA`)
- **Category**: Usually `Unit` for fungible tokens
- **Type**: Token type/contract identifier (`none` for many FTs)
- **AdditionalKey**: Extra identifier (often `none`)

---

## Basic Operations

### Getting a Quote
Before swapping, get a quote for expected output.

- **Endpoint**: `/v1/trade/quote` (see full reference below)  
- **Params**: `tokenIn`, `tokenOut`, and either `amountIn` *or* `amountOut`  
- **Sample (Price Oracle quick GET)**:
```http
GET /price-oracle/fetch-price?token=GALA$Unit$none$none&page=1&limit=10&order=asc
Host: dex-backend-prod1.defi.gala.com
```

### Checking Prices
- **Single token**: `/v1/trade/price` (GET)  
- **Multiple tokens**: `/v1/trade/price-multiple` (POST)  

### Understanding Positions
V3 positions are range-specific:
- Each position has `tickLower` and `tickUpper`
- Positions earn fees from trades within their range
- View via `/v1/trade/positions` and `/v1/trade/position`

---

## Best Practices
1. Always **get a quote** before swapping to understand expected output  
2. Choose pools with an appropriate **fee tier**  
3. **Monitor positions** regularly  
4. Use **slippage protection** (e.g., `sqrtPriceLimit`, min/max amounts)  
5. Keep track of your **token identifiers** (composite keys)

---

## Common Use Cases
- Quote and swap token pairs
- Fetch current and historical prices
- Provide or remove concentrated liquidity within a range
- Track LP positions and collect accrued fees
- Bridge tokens between GalaChain and other networks

---

## Price Oracle APIs

### Subscribe to Token Price Updates
- **Method**: `POST`  
- **Endpoint**: `/price-oracle/subscribe-token`  
- **Body**:
```json
{
  "subscribe": true,
  "token": {
    "collection": "GALA",
    "category": "Unit",
    "type": "none",
    "additionalKey": "none"
  }
}
```
**URL**: `https://dex-backend-prod1.defi.gala.com/price-oracle/subscribe-token`

### Fetch Historical Price Data (GET)
- **Method**: `GET`  
- **Endpoint**: `/price-oracle/fetch-price`  
- **Query**: `token`, `page`, `limit`, `order`  
```http
GET /price-oracle/fetch-price?token=GALA$Unit$none$none&page=1&limit=10&order=asc
Host: dex-backend-prod1.defi.gala.com
```

### Fetch Historical Price Data (POST)
- **Method**: `POST`  
- **Endpoint**: `/price-oracle/fetch-price`  
- **Body**:
```json
{
  "token": "GALA$Unit$none$none",
  "page": 1,
  "limit": 1,
  "from": "2025-06-03T12:30:45Z"
}
```
**URL**: `https://dex-backend-prod1.defi.gala.com/price-oracle/fetch-price`

---

## Trading API Reference

### `/v1/trade/quote` (GET)
Get a quote for trading between two tokens.

**Query Parameters**
| Name     | Type   | Required | Description |
|----------|--------|----------|-------------|
| tokenIn  | string | Yes | Composite key of input token (e.g., `GALA$Unit$none$none`) |
| tokenOut | string | Yes | Composite key of output token |
| amountIn | string | No  | Amount of input token to use |
| amountOut| string | No  | Desired output amount |
| fee      | number | No  | Fee tier (500/3000/10000) |

**Example Request Params**
```json
{
  "tokenIn": "GALA$Unit$none$none",
  "tokenOut": "ETIME$Unit$none$none",
  "amountOut": 1,
  "fee": 500
}
```

**URL**  
`https://dex-backend-prod1.defi.gala.com/v1/trade/quote`

**Response**
```json
{
  "status": 200,
  "message": "Quoted value retrieved successfully.",
  "error": false,
  "data": {
    "currentSqrtPrice": "1.414213562373095048",
    "newSqrtPrice": "2.552346116953373414",
    "fee": 500,
    "amountIn": "6.50106744",
    "amountOut": "1"
  }
}
```

---

### `/v1/trade/add-liq-estimate` (GET)
Estimate amounts for adding liquidity to a pool.

**Query Parameters**
| Name      | Type   | Required | Description |
|-----------|--------|----------|-------------|
| token0    | object | Yes | Token0 composite key |
| token1    | object | Yes | Token1 composite key |
| amount    | string | Yes | Amount of token0 or token1 to supply |
| tickUpper | number | Yes | Upper tick of the position |
| tickLower | number | Yes | Lower tick of the position |
| isToken0  | boolean| Yes | If `true`, `amount` is for token0; else token1 |
| fee       | number | Yes | Fee tier |

**Example**
```json
{
  "token0": "GALA$Unit$none$none",
  "token1": "GUSDC$Unit$none$none",
  "isToken0": true,
  "fee": 3000,
  "tickLower": -887220,
  "tickUpper": 887220,
  "amount": 10
}
```

**URL**  
`https://dex-backend-prod1.defi.gala.com/v1/trade/add-liq-estimate`

**Response**
```json
{
  "status": 200,
  "message": "Add liquidity estimate calculated successfully.",
  "error": false,
  "data": {
    "Status": 1,
    "Data": {
      "amount0": "10",
      "amount1": "6.000950964385306844",
      "liquidity": "7.746580512965257269"
    }
  }
}
```

---

### `/v1/trade/remove-liq-estimate` (GET)
Estimate token amounts when **removing** liquidity from a position.

**Query Parameters**
| Name      | Type   | Required | Description |
|-----------|--------|----------|-------------|
| token0    | object | Yes | Token0 composite key |
| token1    | object | Yes | Token1 composite key |
| amount    | string | No  | Liquidity amount to remove |
| tickUpper | number | No  | Upper tick of the position |
| tickLower | number | No  | Lower tick of the position |
| fee       | number | No  | Fee tier |

**Example**
```json
{
  "token0": "GALA$Unit$none$none",
  "token1": "GUSDC$Unit$none$none",
  "owner": "eth|EBDff87C1E582AE52fc3f175dFe873AD9bF42aFD",
  "tickLower": -43000,
  "tickUpper": -42800,
  "fee": 10000,
  "amount": 0.01
}
```

**URL**  
`https://dex-backend-prod1.defi.gala.com/v1/trade/remove-liq-estimate`

**Response**
```json
{
  "status": 200,
  "message": "Remove liquidity estimate calculated successfully.",
  "error": false,
  "data": {
    "Status": 1,
    "Data": {
      "amount0": "0.00000000",
      "amount1": "0.000011"
    }
  }
}
```

---

### `/v1/trade/price` (GET)
Get the current price of a token.

**Query Parameters**
| Name  | Type   | Required | Description |
|-------|--------|----------|-------------|
| token | string | Yes | Composite key |

**Example**
```json
{ "token": "GALA$Unit$none$none" }
```

**URL**  
`https://dex-backend-prod1.defi.gala.com/v1/trade/price`

**Response**
```json
{ "price": "number", "timestamp": "string" }
```

---

### `/v1/trade/price-multiple` (POST)
Get prices for multiple tokens.

**Body**
```json
{
  "tokens": [
    "Token$Unit$THREDEXT$client:6337024724eec8c292f0118d",
    "Token$Unit$TWODEXT$client:6337024724eec8c292f0118d",
    "GTON$Unit$none$none",
    "Token$Unit$BJYT$eth:3E182a9784ED72c52a99C4Ac94E107d1222459E0",
    "ETIME$Unit$none$none",
    "GOSMI$Unit$none$none",
    "GUSDC$Unit$none$none"
  ]
}
```

**URL**  
`https://dex-backend-prod1.defi.gala.com/v1/trade/price-multiple`

**Response**
```json
{
  "status": 200,
  "message": "Price fetched successfully",
  "error": false,
  "data": ["0.041954", "0.002360164224", "10", "0", "0.102712537972", "1.241736116148", "1"]
}
```

---

### `/v1/trade/position` (GET)
Get details of a specific **user position**.

**Query Parameters**
| Name     | Type   | Required | Description |
|----------|--------|----------|-------------|
| token0   | string | Yes | Token0 composite key |
| token1   | string | Yes | Token1 composite key |
| fee      | number | Yes | Pool fee tier |
| tickLower| number | Yes | Lower tick |
| tickUpper| number | Yes | Upper tick |
| owner    | string | Yes | Owner in format `eth|<address>` |

**URL**  
`https://dex-backend-prod1.defi.gala.com/v1/trade/position`

**Sample Response** *(truncated)*
```json
{
  "status": 200,
  "message": "User position retrieved successfully.",
  "error": false,
  "data": {
    "Status": 1,
    "Data": {
      "fee": 10000,
      "liquidity": "306.199221258460498503",
      "tickLower": -886800,
      "tickUpper": -42000,
      "token0ClassKey": { "collection": "GALA", "category": "Unit", "type": "none", "additionalKey": "none" },
      "token1ClassKey": { "collection": "GUSDC", "category": "Unit", "type": "none", "additionalKey": "none" },
      "tokensOwed0": "1176.23592155",
      "tokensOwed1": "0.334446"
    }
  }
}
```

---

### `/v1/trade/positions` (GET)
Get **all positions** for a user.

**Query Parameters**
| Name   | Type   | Required | Description |
|--------|--------|----------|-------------|
| user   | string | Yes | User address (e.g., `eth|0x...`) |
| limit  | number | Yes | Max items |
| bookmark | string | No | Pagination bookmark |

**URL**  
`https://dex-backend-prod1.defi.gala.com/v1/trade/positions`

**Sample Response** *(truncated)*
```json
{
  "status": 200,
  "message": "User positions retrieved successfully.",
  "error": false,
  "data": {
    "Status": 1,
    "Data": {
      "nextBookMark": "",
      "positions": [
        {
          "fee": 10000,
          "liquidity": "9",
          "token0Symbol": "FOURDEXT",
          "token1Symbol": "TWODEXT"
        }
      ]
    }
  }
}
```

---

### `/v1/trade/pool` (GET)
Get **pool** details.

**Query Parameters**
| Name  | Type   | Required | Description |
|-------|--------|----------|-------------|
| token0| string | Yes | Token0 composite key |
| token1| string | Yes | Token1 composite key |
| fee   | number | Yes | Fee tier |

**URL**  
`https://dex-backend-prod1.defi.gala.com/v1/trade/pool`

**Response** *(truncated)*
```json
{
  "status": 200,
  "message": "Pool details retrieved successfully.",
  "error": false,
  "data": {
    "Status": 1,
    "Data": {
      "fee": 3000,
      "grossPoolLiquidity": "336376.08886291150109088",
      "sqrtPrice": "7.51461043319390978954",
      "tickSpacing": 60,
      "token0": "GALA$Unit$none$none",
      "token1": "SILK$Unit$none$none"
    }
  }
}
```

---

## Payload Generation API Reference

### `/v1/trade/swap` (POST)
Generate a **swap** operation payload (to be signed, then executed via bundle).

**Body**
```json
{
  "tokenIn": { "collection": "GALA", "category": "Unit", "type": "none", "additionalKey": "none" },
  "tokenOut": { "collection": "GUSDC", "category": "Unit", "type": "none", "additionalKey": "none" },
  "amountIn": "0.1",
  "fee": 10000,
  "sqrtPriceLimit": "0.000000000000000000094212147",
  "amountInMaximum": "1",
  "amountOutMinimum": "-0.090899799599198396"
}
```

**URL**  
`https://dex-backend-prod1.defi.gala.com/v1/trade/swap`

**Response** *(truncated)*
```json
{
  "status": 200,
  "message": "Swap payload created successfully.",
  "error": false,
  "data": {
    "zeroForOne": true,
    "uniqueKey": "galaswap-operation-4f9882cd-07c3-4612-964e-188a49b6d960"
  }
}
```

---

### `/v1/trade/collect` (POST)
Generate a **collect fees** operation payload.

**Body**
```json
{
  "token0": { "collection": "GALA", "category": "Unit", "type": "none", "additionalKey": "none" },
  "token1": { "collection": "Token", "category": "Unit", "type": "TUSA", "additionalKey": "eth:Af379..." },
  "amount0Requested": "0.0000243",
  "amount1Requested": "0",
  "fee": 3000,
  "tickLower": -887220,
  "tickUpper": 887220
}
```

**URL**  
`https://dex-backend-prod1.defi.gala.com/v1/trade/collect`

---

### `/v1/trade/liquidity` (POST add, DELETE remove)

**Add Liquidity – POST Body**
```json
{
  "token0": { "collection": "GALA", "category": "Unit", "type": "none", "additionalKey": "none" },
  "token1": { "collection": "Token", "category": "Unit", "type": "TUSA", "additionalKey": "eth:Af379..." },
  "fee": 3000,
  "tickLower": -887220,
  "tickUpper": 887220,
  "amount0Desired": "0.001",
  "amount1Desired": "0.025075169088133953",
  "amount0Min": "0.00095",
  "amount1Min": "0.001"
}
```

**Remove Liquidity – DELETE Body**
```json
{
  "token0": { "collection": "GALA", "category": "Unit", "type": "none", "additionalKey": "none" },
  "token1": { "collection": "Token", "category": "Unit", "type": "TUSA", "additionalKey": "eth:Af379..." },
  "fee": 3000,
  "tickLower": -887220,
  "tickUpper": 887220,
  "amount": "0.01",
  "amount0Min": "0.01",
  "amount1Min": "0.01"
}
```

**URL**  
`https://dex-backend-prod1.defi.gala.com/v1/trade/liquidity`

---

### `/v1/trade/create-pool` (POST)
Generate a **create pool** operation payload.

**Body**
```json
{
  "token0": { "collection": "GALA", "category": "Unit", "type": "none", "additionalKey": "none" },
  "token1": { "collection": "Token", "category": "Unit", "type": "TUSA", "additionalKey": "eth:Af379..." },
  "initialSqrtPrice": "10",
  "fee": 3000
}
```

**URL**  
`https://dex-backend-prod1.defi.gala.com/v1/trade/create-pool`

---

## Bundle & Execution

### `/v1/trade/bundle` (POST)
Execute a **signed** transaction (or bundle).

**Body (example addLiquidity)**
```json
{
  "payload": { "...": "payload from a payload-generation endpoint" },
  "type": "addLiquidity",
  "signature": "0x...",
  "user": "eth|d150F03CD1B94529437c1438B993fbDa45AB4E9a"
}
```

**URL**  
`https://dex-backend-prod1.defi.gala.com/v1/trade/bundle`

**Response**
```json
{
  "status": 201,
  "message": "Execution was successful",
  "error": false,
  "data": {
    "data": "a9d0ec74-a80c-4594-997f-de9cef9d40a9",
    "message": "Transaction Received",
    "error": false
  }
}
```

### `/v1/trade/transaction-status` (GET)
Check transaction status by ID.

**Query**
```json
{ "id": "1402908f-ff2c-4aca-8638-0d363d72dd91" }
```

**URL**  
`https://dex-backend-prod1.defi.gala.com/v1/trade/transaction-status`

**Sample Response**
```json
{
  "status": 200,
  "message": "Transaction status fetched successfully",
  "error": false,
  "data": {
    "id": "1402908f-ff2c-4aca-8638-0d363d72dd91",
    "method": "Swap",
    "status": "FAILED"
  }
}
```

### WebSocket Events
**Socket Server URL**: `wss://bundle-backend-prod1.defi.gala.com`  
Connect with Socket.IO client and listen for events.

**Sample Message**
```json
[
  "fbb77f86-c73e-4c3f-9620-db1bad5c9967",
  {
    "status": "FAILED",
    "data": {
      "ErrorCode": 412,
      "ErrorKey": "SLIPPAGE_TOLERANCE_EXCEEDED",
      "Message": "Slippage tolerance exceeded: minimum received tokens (-0.09089979959919840257764889202) is less than actual received amount (-0.00420227483166245516500959344693380632).",
      "Status": 0,
      "transactionId": "7ca2abb4074321955d00d21222467e036b855e4ba8aa4dc9d360552d4a282040"
    }
  }
]
```

---

## Bridging API Reference

### `/v1/connect/bridge-configurations` (GET)
Discover bridge configuration for tokens and supported networks.

**Query**
```json
{ "searchprefix": "WETH" }
```
**URL**  
`https://dex-backend-prod1.defi.gala.com/v1/connect/bridge-configurations`

**Sample Response** *(truncated)*
```json
{
  "status": 200,
  "error": false,
  "message": "Request successful",
  "data": { "tokens": [ { "name": "GWETH", "network": "GC", "canBridgeTo": [ { "network": "Ethereum", "symbol": "WETH", "destinationChainIds": ["2"] } ] } ] }
}
```

**Response Body Fields (high level)**  
- `data.tokens[]`: Token objects (decimals, name, verified, network `GC`, symbol, composite key parts, channel)  
- `canBridgeTo[]`: Array of networks you can bridge to (Ethereum, Solana, TON) with `destinationChainIds` (1=GC, 2=Ethereum, 1001=TON, 1002=Solana)  
- `otherNetworks[]`: Mirror info for other chain contracts

---

### `/v1/connect/bridge/request` (POST)
Create a **bridge request** (GalaChain → other chain).

**Body**
```json
{
  "destinationChainId": 2,
  "recipient": "0x0000000000000000000000000000000000000000",
  "walletAddress": "client|111111111111111111111111",
  "quantity": "10",
  "token": { "collection": "GALA", "category": "Unit", "type": "none", "additionalKey": "none" }
}
```
**URL**  
`https://dex-backend-prod1.defi.gala.com/v1/connect/bridge/request`

**Response** *(truncated)*
```json
{ "status": 200, "error": false, "data": { "fee": "0.13446206", "feeToken": "GALA|Unit|none|none", "dto": {} } }
```

---

### `/v1/connect/RequestTokenBridgeOut` (POST)
Submit the **signed** request created by the previous step.

**Body** *(fields from prior response + `uniqueKey` + `signature`)*
```json
{
  "uniqueKey": "galaconnect-operation-123e4567-e89b-12d3-a456-426614174000",
  "signature": "0x123...",
  "... other properties from dto ...": "values"
}
```

**URL**  
`https://dex-backend-prod1.defi.gala.com/v1/connect/RequestTokenBridgeOut`

**Response** *(truncated)*
```json
{ "status": 201, "data": { "Data": "GCTXR|..." } }
```

---

### `/v1/connect/BridgeTokenOut` (POST)
Finalize the bridge (second call).

**Body**
```json
{
  "bridgeFromChannel": "asset",
  "bridgeRequestId": "GCTXR|...",
  "signature": "0x123..."
}
```

**URL**  
`https://dex-backend-prod1.defi.gala.com/v1/connect/BridgeTokenOut`

**Response** *(truncated)*
```json
{ "status": 201, "data": { "Hash": "08ea70...", "Status": 1 } }
```

---

### `/v1/connect/bridge/status` (POST)
Check **bridge operation** status. `status = 5` means success; `6` or `7` means failure; `<5` are pending stages.

**Body**
```json
{ "hash": "6d44dc30f6adcbd0fd594615d470c947dd6e21204e9127ff78adce1d3985a79f" }
```

**URL**  
`https://dex-backend-prod1.defi.gala.com/v1/connect/bridge/status`

**Sample Response** *(truncated)*
```json
{
  "status": 200,
  "data": {
    "fromChain": "GC",
    "toChain": "Ethereum",
    "quantity": "10",
    "status": 4,
    "statusDescription": "DeliveryInProgress",
    "emitterTransactionHash": "6d44dc30..."
  }
}
```

---

## Payload Signing

### Signing with the GalaChain Node.js SDK
**Install**
```bash
npm install @gala-chain/api
```

**Example**
```ts
import { signatures } from "@gala-chain/api";

const privateKey = "0x...";
const objectToSign = {
  "field1": "field1",
  "field2": "field2",
  "field3": "field3",
  "uniqueKey": "some-unique-value"
};

const signature = signatures.getSignature(
  objectToSign,
  Buffer.from(privateKey.replace('0x', ''), 'hex')
);

const signedObject = { ...objectToSign, signature };
console.log(signedObject);
```

> **Security**: Never commit or share private keys. Use environment variables or secure key management.

### Reference: Manual Signing Utilities
**Install**
```bash
npm install class-transformer json-stringify-deterministic js-sha3 bn.js
```

**Script (TypeScript)**
```ts
import { instanceToPlain } from "class-transformer";
import stringify from "json-stringify-deterministic";
import { keccak256 } from "js-sha3";
import BN from "bn.js";
import { ec as EC } from "elliptic";

const ecSecp256k1 = new EC("secp256k1");

export async function signMessage(data: any, privateKey: string) {
  try {
    const s = getSignature(data, normalizePrivateKey(privateKey));
    return s;
  } catch (error) {
    console.error("Error signing message:", error);
    return "";
  }
}

function normalizePrivateKey(input: string): Buffer {
  return Buffer.from(input.replace('0x', ''), 'hex');
}

function getSignature(obj: object, privateKey: Buffer): string {
  const data = Buffer.from(getPayloadToSign(obj));
  return signSecp256k1(calculateKeccak256(data), privateKey);
}

function calculateKeccak256(data: Buffer): Buffer {
  return Buffer.from(keccak256.digest(data));
}

function signSecp256k1(dataHash: Buffer, privateKey: Buffer, useDer?: "DER"): string {
  if (dataHash.length !== 32) throw new Error("secp256k1 can sign only 32-byte keccak hashes");
  let signature = ecSecp256k1.sign(dataHash, privateKey);
  if (signature.s.cmp(ecSecp256k1.curve.n.shrn(1)) > 0) signature.s = ecSecp256k1.curve.n.sub(signature.s);
  if (!useDer) {
    return signature.r.toString("hex", 32) + signature.s.toString("hex", 32) + new BN(signature.recoveryParam === 1 ? 28 : 27).toString("hex", 1);
  } else {
    return Buffer.from(signature.toDER()).toString("hex");
  }
}

export function getPayloadToSign(obj: object): string {
  const { signature, trace, ...plain } = instanceToPlain(obj);
  return stringify(instanceToPlain(plain));
}
```

---

## Bridging Guides & Code Samples

### Ethereum → GalaChain
**Install**
```bash
npm install ethers bignumber.js
```

**Example (TypeScript/JS)**
```ts
import { ethers, Wallet, Contract } from 'ethers';
import { BigNumber } from 'bignumber.js';

const PRIVATE_KEY = '';
const ETHEREUM_NODE_URL = '';
const TOKEN_CONTRACT_ADDRESS = '';
const BRIDGE_TO_GALACHAIN_ADDRESS = '';
const QUANTITY_TO_BRIDGE = 1000;

const BRIDGE_CONTRACT_ADDRESS = '0x9f452b7cC24e6e6FA690fe77CF5dD2ba3DbF1ED9';
const DESTINATION_CHAIN_ID = 1;
const USE_PERMITTED_BRIDGE = false; // uses permit if supported

const main = async () => {
  const provider = new ethers.JsonRpcProvider(ETHEREUM_NODE_URL);
  const signer = new Wallet(PRIVATE_KEY, provider);

  const tokenContract = new Contract(
    TOKEN_CONTRACT_ADDRESS,
    [
      {"inputs":[{"internalType":"address","name":"_spender","type":"address"},{"internalType":"uint256","name":"_value","type":"uint256"}],"name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},
      {"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"pure","type":"function"},
      {"inputs":[{"internalType":"address","name":"_owner","type":"address"},{"internalType":"address","name":"_spender","type":"address"},{"internalType":"uint256","name":"_value","type":"uint256"},{"internalType":"uint256","name":"_deadline","type":"uint256"},{"internalType":"uint8","name":"_v","type":"uint8"},{"internalType":"bytes32","name":"_r","type":"bytes32"},{"internalType":"bytes32","name":"_s","type":"bytes32"}],"name":"permit","outputs":[],"stateMutability":"nonpayable","type":"function"},
      {"inputs":[{"internalType":"address","name":"owner","type":"address"}],"name":"nonces","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
      {"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"}
    ],
    signer
  );

  const bridgeContract = new Contract(
    BRIDGE_CONTRACT_ADDRESS,
    [
      {"inputs":[{"internalType":"address","name":"token","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"uint256","name":"tokenId","type":"uint256"},{"internalType":"uint16","name":"destinationChainId","type":"uint16"},{"internalType":"bytes","name":"recipient","type":"bytes"}],"name":"bridgeOut","outputs":[],"stateMutability":"nonpayable","type":"function"},
      {"inputs":[{"internalType":"address","name":"token","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"uint16","name":"destinationChainId","type":"uint16"},{"internalType":"bytes","name":"recipient","type":"bytes"},{"internalType":"uint256","name":"deadline","type":"uint256"},{"internalType":"uint8","name":"v","type":"uint8"},{"internalType":"bytes32","name":"r","type":"bytes32"},{"internalType":"bytes32","name":"s","type":"bytes32"}],"name":"bridgeOutWithPermit","outputs":[],"stateMutability":"nonpayable","type":"function"}
    ],
    signer
  );

  const decimals = await tokenContract.decimals();
  const parsedQuantity = BigInt(new BigNumber(QUANTITY_TO_BRIDGE).multipliedBy(10 ** Number(decimals)).toString());

  if (USE_PERMITTED_BRIDGE) {
    const [nonce, name, network] = await Promise.all([
      tokenContract.nonces(signer.address),
      tokenContract.name(),
      provider.getNetwork()
    ]);

    const signature = await signer.signTypedData(
      { name, version: '1', chainId: network.chainId, verifyingContract: TOKEN_CONTRACT_ADDRESS },
      { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
      { owner: signer.address, spender: BRIDGE_CONTRACT_ADDRESS, value: parsedQuantity, nonce, deadline: ethers.MaxUint256 }
    );

    const split = ethers.Signature.from(signature);
    const tx = await bridgeContract.bridgeOutWithPermit(
      TOKEN_CONTRACT_ADDRESS, parsedQuantity, DESTINATION_CHAIN_ID, new TextEncoder().encode(BRIDGE_TO_GALACHAIN_ADDRESS),
      ethers.MaxUint256, split.v, split.r, split.s
    );
    console.log(`Bridge tx: ${tx.hash}`);
  } else {
    const approve = await tokenContract.approve(BRIDGE_CONTRACT_ADDRESS, parsedQuantity);
    await approve.wait();
    const tx = await bridgeContract.bridgeOut(TOKEN_CONTRACT_ADDRESS, parsedQuantity, 0, DESTINATION_CHAIN_ID, new TextEncoder().encode(BRIDGE_TO_GALACHAIN_ADDRESS));
    console.log(`Bridge tx: ${tx.hash}`);
  }
};

main().catch(console.error);
```

---

### GalaChain → Other Chains
**Install**
```bash
npm install @gala-chain/api
```

**Example (TypeScript/JS)**
```ts
import crypto from 'crypto';
import { signatures } from "@gala-chain/api";

// Configure these values accordingly
const TOKEN_SYMBOL_TO_BRIDGE = 'GALA';
const AMOUNT_TO_BRIDGE = 10;
const TARGET_CHAIN_ID = 2; // 2=Ethereum, 1002=Solana
const BRIDGE_FROM_WALLET_ADDRESS = 'client|000...';
const BRIDGE_RECIPIENT_WALLET_ADDRESS = '0x000...';
const BRIDGE_FROM_WALLET_PRIVATE_KEY = '0x...';

const API_BASE_URL = 'https://dex-backend-prod1.defi.gala.com';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const tokensResponse = await fetch(`${API_BASE_URL}/v1/connect/bridge-configurations?searchprefix=${TOKEN_SYMBOL_TO_BRIDGE}`);
  const tokenResponseJson = await tokensResponse.json();

  const token = tokenResponseJson.data.tokens.find(
    (t: any) => t.verified && t.symbol === TOKEN_SYMBOL_TO_BRIDGE && t.canBridgeTo?.some((b: any) => b.destinationChainIds.includes(String(TARGET_CHAIN_ID)))
  );
  if (!token) throw new Error('No verified token found that can bridge to target chain');

  const bridgeRequestResponse = await fetch(`${API_BASE_URL}/v1/connect/bridge/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      destinationChainId: TARGET_CHAIN_ID,
      recipient: BRIDGE_RECIPIENT_WALLET_ADDRESS,
      quantity: AMOUNT_TO_BRIDGE.toString(),
      walletAddress: BRIDGE_FROM_WALLET_ADDRESS,
      token: {
        collection: token.collection, category: token.category, type: token.type, additionalKey: token.additionalKey
      }
    })
  });
  const bridgeRequestJson = await bridgeRequestResponse.json();

  const keyBuffer = signatures.normalizePrivateKey(BRIDGE_FROM_WALLET_PRIVATE_KEY);
  const bodyToSign = { ...bridgeRequestJson.data.dto, uniqueKey: `galaconnect-operation-${crypto.randomUUID()}` };
  const signature = signatures.getSignature(bodyToSign, keyBuffer);
  const signedBridgeOperation = { ...bodyToSign, signature };

  const requestBridgeOutResponse = await fetch(`${API_BASE_URL}/v1/connect/RequestTokenBridgeOut`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signedBridgeOperation)
  });
  const bridgeRequestId = (await requestBridgeOutResponse.json()).data.Data;

  const bridgeOutResponse = await fetch(`${API_BASE_URL}/v1/connect/BridgeTokenOut`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bridgeFromChannel: 'asset', bridgeRequestId })
  });
  const bridgeOutHash = (await bridgeOutResponse.json()).data.Hash;

  console.log(`Sent ${AMOUNT_TO_BRIDGE} ${TOKEN_SYMBOL_TO_BRIDGE} to the bridge. Hash: ${bridgeOutHash}`);

  while (true) {
    await sleep(15000);
    const statusResponse = await fetch(`${API_BASE_URL}/v1/connect/bridge/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash: bridgeOutHash })
    });
    const statusJson = await statusResponse.json();
    if (statusJson.data.status === 5) { console.log('Bridge completed', statusJson.data); break; }
    if (statusJson.data.status === 6 || statusJson.data.status === 7) { console.log('Bridge failed', statusJson.data); break; }
    console.log('Bridge pending...');
  }
}

main();
```

---

### Solana → GalaChain
**Install**
```bash
npm install @solana/web3.js @solana/spl-token bignumber.js @coral-xyz/anchor bs58
```

**Example (TypeScript/JS)** *(truncated program definition for brevity)*
```ts
import { Connection, PublicKey, Transaction, Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import { AnchorProvider, BN, Program, Wallet } from '@coral-xyz/anchor';
import { BigNumber } from 'bignumber.js';
import bs58 from 'bs58';

const SOLANA_NODE_URL = '';
const USER_SECRET_KEY: string | number[] = '';
const TOKEN_CONTRACT_ADDRESS: string = '';
const BRIDGE_TO_ADDRESS = '';
const QUANTITY_TO_BRIDGE = 1;

const main = async () => {
  const decodedSecretKey = Array.isArray(USER_SECRET_KEY) ? Buffer.from(USER_SECRET_KEY) : bs58.decode(USER_SECRET_KEY);
  const connection = new Connection(SOLANA_NODE_URL, { commitment: 'confirmed' });
  const signer = new Wallet(Keypair.fromSecretKey(decodedSecretKey));

  const provider = new AnchorProvider(connection, signer, { commitment: 'confirmed', preflightCommitment: 'processed' });
  // ... instantiate Program with provided IDL (omitted) ...

  // helper utils
  const toBaseUnits = (tokens: BigNumber.Value, decimals: number) => BigNumber(tokens).multipliedBy(Math.pow(10, decimals));
  const getAssociatedTokenAddress = (token: string|PublicKey, owner: string|PublicKey, allowOwnerOffCurve?: boolean) =>
    getAssociatedTokenAddressSync(typeof token==='string'?new PublicKey(token):token, typeof owner==='string'?new PublicKey(owner):owner, allowOwnerOffCurve);
  const getTokenMintInfo = async (addr: string|PublicKey) => getMint(connection, typeof addr==='string'?new PublicKey(addr):addr);

  let transactionParams: Transaction;
  if (TOKEN_CONTRACT_ADDRESS === 'sol') {
    transactionParams = new Transaction(); // build `bridge_out_native` via Anchor (omitted for brevity)
  } else {
    const bridgeTokenPk = new PublicKey(TOKEN_CONTRACT_ADDRESS);
    const userTokenAccount = getAssociatedTokenAddress(bridgeTokenPk, signer.publicKey);
    const mintInfo = await getTokenMintInfo(bridgeTokenPk);
    transactionParams = new Transaction(); // build `bridge_out` via Anchor (omitted)
  }

  const txSig = await provider.sendAndConfirm(transactionParams);
  console.log(`Transaction sent - ${txSig}`);
};

main().catch(e => { console.error(e); process.exit(1); });
```

---

## Notes
- **Security**: Never expose private keys. Prefer secure env vars and vaults.
- **Slippage**: Use `sqrtPriceLimit`, `amountInMaximum`, and `amountOutMinimum` to control execution.
- **Composite Keys**: Maintain correct `Collection$Category$Type$AdditionalKey` values across endpoints.

