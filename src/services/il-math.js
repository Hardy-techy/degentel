const axios = require('axios');

const BASE_URL = 'https://api.geckoterminal.com/api/v2';

/**
 * Service 1: IL Forecaster
 * Fetches 30-day OHLCV data to calculate historical volatility and project Impermanent Loss.
 */
async function forecastImpermanentLoss(network, poolAddress) {
    try {
        // Fetch last 30 days of daily OHLCV
        const res = await axios.get(`${BASE_URL}/networks/${network}/pools/${poolAddress}/ohlcv/day?aggregate=1&limit=30`);
        const ohlcv = res.data.data.attributes.ohlcv_list; // Format: [timestamp, open, high, low, close, volume]

        if (!ohlcv || ohlcv.length < 2) {
            throw new Error("Not enough historical data to calculate volatility.");
        }

        const dataPoints = ohlcv.length;
        const latestPrice = parseFloat(ohlcv[0][4]);

        // Calculate daily returns based on closing prices (index 4)
        const dailyReturns = [];
        for (let i = 0; i < ohlcv.length - 1; i++) {
            const todayClose = parseFloat(ohlcv[i][4]);
            const yesterdayClose = parseFloat(ohlcv[i + 1][4]); // list is ordered newest to oldest
            if (yesterdayClose > 0) {
                dailyReturns.push((todayClose - yesterdayClose) / yesterdayClose);
            }
        }

        // Calculate Standard Deviation (Historical Volatility)
        const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
        const variance = dailyReturns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / dailyReturns.length;
        const stdDev = Math.sqrt(variance);

        // Project price ratio drift over a month based on 1 std dev (simple heuristic)
        const priceRatio = 1 + stdDev;

        // Impermanent Loss Formula: 2 * sqrt(k) / (1 + k) - 1
        let projectedIL = 0;
        if (priceRatio > 0) {
            projectedIL = (2 * Math.sqrt(priceRatio) / (1 + priceRatio)) - 1;
        }

        // Convert to percentage (absolute value)
        const ilPercentage = Math.abs(projectedIL) * 100;
        const ilPer1000 = Math.abs(projectedIL) * 1000; // Expected dollar loss per $1000

        // --- NEW: Monte Carlo Simulation ---
        function randomNormal() {
            let u = 0, v = 0;
            while (u === 0) u = Math.random(); 
            while (v === 0) v = Math.random();
            return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        }

        const daysToSimulate = 30;
        const simulations = 1000;
        let ilScenarios = [];

        for (let i = 0; i < simulations; i++) {
            let simulatedPriceRatio = 1.0;
            for (let day = 0; day < daysToSimulate; day++) {
                const dailyReturn = mean + stdDev * randomNormal();
                simulatedPriceRatio *= (1 + dailyReturn);
            }
            simulatedPriceRatio = Math.max(0.0001, simulatedPriceRatio);
            const il = (2 * Math.sqrt(simulatedPriceRatio) / (1 + simulatedPriceRatio)) - 1;
            ilScenarios.push(Math.abs(il) * 100);
        }

        const monteCarloAverage = ilScenarios.reduce((a, b) => a + b, 0) / simulations;
        ilScenarios.sort((a, b) => a - b);
        const maxPain = ilScenarios[Math.floor(simulations * 0.95)];
        // -----------------------------------

        let riskClass = "Low";
        if (maxPain > 10) riskClass = "Medium";
        if (maxPain > 30) riskClass = "High";

        return {
            analyzed_timeframe_days: dataPoints,
            historical_daily_volatility: parseFloat(stdDev.toFixed(4)),
            annualized_volatility: parseFloat((stdDev * Math.sqrt(365)).toFixed(4)),
            expected_price_divergence: parseFloat(priceRatio.toFixed(4)),
            projected_il_percentage: parseFloat(ilPercentage.toFixed(2)),
            projected_loss_per_1000_usd: parseFloat(ilPer1000.toFixed(2)),
            risk_classification: riskClass,
            monte_carlo_average_il: parseFloat(monteCarloAverage.toFixed(2)),
            max_pain_il_percent: parseFloat(maxPain.toFixed(2)),
            summary: `IL Forecaster completed. Analyzed ${dataPoints} days of OHLCV data. Annualized volatility is ${(stdDev * Math.sqrt(365) * 100).toFixed(2)}%. Monte Carlo 1,000-scenario simulation yields an average IL of ${monteCarloAverage.toFixed(2)}%, with a 'Max Pain' 95th-percentile crash risk of ${maxPain.toFixed(2)}%. Overall Risk: ${riskClass}.`
        };

    } catch (error) {
        throw new Error(`Failed to forecast IL: ${error.message}`);
    }
}

module.exports = {
    forecastImpermanentLoss
};
