# Degentel LP 🔮

**Degentel LP** is an institutional-grade DeFi Infrastructure Node built on the **CROO Agent Protocol**.

While most Web3 AI agents focus on basic token safety (e.g., honeypot checks), serious DeFi capital requires deep mathematical forensics before providing liquidity to Automated Market Makers (AMMs). Degentel LP provides deterministic, on-chain analytics and Impermanent Loss projections for Yield Farmers, DAOs, and AI Trading Bots.

---

## 🚀 The 3 Core Services

Degentel LP exposes 3 highly specialized services to the CROO Network, enabling Agent-to-Agent (A2A) and Human-to-Agent (H2A) commerce.

### 1. IL Forecaster 📉
Predicts Impermanent Loss risk before capital is deployed using historical data and Monte Carlo simulations.
* **How it works:** Pulls 30 days of OHLCV data for a specific Liquidity Pool to calculate the historical standard deviation (volatility). It then runs a 1,000-scenario Monte Carlo simulation to project future price paths.
* **Input Requirement:** `network` (string), `target_liquidity_pool_address` (string)
* **Output Deliverable:** 
  - `projected_il_percentage` (number)
  - `projected_loss_per_1000_usd` (number)
  - `monte_carlo_average_il` (number)
  - `max_pain_il_percent` (number)
  - `historical_daily_volatility` (number)
  - `annualized_volatility` (number)
  - `expected_price_divergence` (number)
  - `risk_classification` (string)
  - `summary` (string)

### 2. Deep Liquidity Audit 🔎
Evaluates the true financial health and profitability of an AMM Pool.
* **How it works:** Extracts deep on-chain metrics including Fully Diluted Valuation (FDV), 24-hour Buy/Sell ratios, unique transactors, pool age, and analyzes liquidity thickness.
* **Input Requirement:** `network` (string), `target_liquidity_pool_address` (string)
* **Output Deliverable:** 
  - `pool_name` (string), `pool_created_at` (string), `pool_age_days` (number)
  - `fully_diluted_valuation_usd` (number), `total_value_locked_usd` (number)
  - `volume_24h_usd` (number), `price_change_24h_percentage` (number)
  - `transactions_24h` (object containing deep buy/sell/transactor metrics)
  - `liquidity_metrics` (object containing capital efficiency and estimated APY)
  - `fdv_to_tvl_ratio` (number)
  - `simulated_5k_slippage_percent` (number)
  - `mev_toxicity_score` (number)
  - `is_fragile_liquidity` (boolean)
  - `summary` (string)

### 3. Yield Route Finder 🛣️
Discovers the highest-yielding deployment routes for a specific token.
* **How it works:** Scans all Decentralized Exchanges (DEXes) on a given network for a target token, sorts them by volume and capital efficiency, and formats the output into clean JSON for bot consumption.
* **Input Requirement:** `network` (string), `target_token_address` (string)
* **Output Deliverable:** 
  - `routes` (object containing `route_1`, `route_2`, `route_3` strings detailing the top 3 pools)
  - `summary` (string)

---

## 🛡️ Built-in SLA Protection Engine
One of the most advanced features of Degentel LP is its strict pre-execution validation:
* **Network Filtering**: Supports 5 EVM chains (`ethereum`, `base`, `arbitrum`, `polygon`, `bsc`). The agent automatically verifies the network before proceeding to protect your SLA.
* **Resource Validation**: Verifies that the requested token or pool actually exists on-chain before accepting the escrow lock.
* **Result**: Zero failed executions during the *Deliver* phase, ensuring a pristine 100% SLA Completion Rating on the CROO network.

---

## ⚙️ Technical Architecture
- **CROO Node.js SDK**: Natively integrates with the CROO Agent Protocol for trust-minimized escrow, strict schema enforcement, and automated delivery.
- **Dynamic Routing**: Uses `order.serviceId` to natively map dashboard UI orders to backend logic without requiring users to input service types manually.
- **GeckoTerminal Data Engine**: Pulls deterministic, real-time blockchain data across multiple networks via Axios.

---

## 💻 Getting Started (Local Deployment)

1. **Clone the repository and install dependencies:**
```bash
npm install
```

2. **Configure your `.env` file:**
Create a `.env` file in the root directory. You must register an agent on the [CROO Dashboard](https://agent.croo.network) to get an API Key and create your 3 services to get Service IDs.
```env
CROO_API_URL=https://api.croo.network
CROO_WS_URL=wss://api.croo.network/ws

# Authentication (From CROO Dashboard)
CROO_SDK_KEY=your_sk_key_here

# Service IDs (From CROO Dashboard)
CROO_SERVICE_IL_FORECAST=srv_123
CROO_SERVICE_AUDIT=srv_456
CROO_SERVICE_ROUTE_FINDER=srv_789
```

3. **Start the Agent Provider:**
```bash
npm start
# or
node src/index.js
```
*The agent will instantly connect to the CROO WebSocket, transition from `draft` to `online`, and begin listening for incoming on-chain orders.*
