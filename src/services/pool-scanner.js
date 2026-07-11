const axios = require('axios');

const BASE_URL = 'https://api.geckoterminal.com/api/v2';

/**
 * Service 2: Deep Liquidity Audit
 * Fetches deep pool details (TVL, volume, transactions, age) and calculates capital efficiency
 */
async function auditPool(network, poolAddress) {
    try {
        const res = await axios.get(`${BASE_URL}/networks/${network}/pools/${poolAddress}`);
        const pool = res.data.data.attributes;

        const tvl = parseFloat(pool.reserve_in_usd) || 0;
        const volume24h = parseFloat(pool.volume_usd?.h24) || 0;
        const fdv = parseFloat(pool.fdv_usd) || 0;
        const priceChange24h = parseFloat(pool.price_change_percentage?.h24) || 0;

        // Transaction tracking
        const txns = pool.transactions?.h24 || { buys: 0, sells: 0, buyers: 0, sellers: 0 };
        const totalTxns = txns.buys + txns.sells;
        const buySellRatio = txns.sells > 0 ? (txns.buys / txns.sells) : txns.buys;

        // Calculate pool age in days
        const createdAt = new Date(pool.pool_created_at);
        const ageMs = Date.now() - createdAt.getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);

        // Capital Efficiency = Volume / TVL
        const capitalEfficiency = tvl > 0 ? (volume24h / tvl) : 0;

        // Estimate daily fee APY assuming a standard 0.3% pool fee
        const estimatedApy = tvl > 0 ? ((volume24h * 0.003 * 365) / tvl) * 100 : 0;

        // --- NEW: Slippage Simulator (AMM x*y=k) ---
        // For a 50/50 pool, slippage = trade_size / (pool_balance + trade_size)
        // Pool balance of one side is TVL / 2
        const tradeSize = 5000;
        let slippagePercent = 0;
        if (tvl > 0) {
            const sideBalance = tvl / 2;
            slippagePercent = (tradeSize / (sideBalance + tradeSize)) * 100;
        }

        // --- NEW: MEV Toxicity Index ---
        const totalUsers = txns.buyers + txns.sellers;
        let mevToxicityScore = 0;
        if (totalTxns > 0 && totalUsers > 0) {
            // High txns but low unique users = high toxicity (bots)
            const botRatio = 1 - (totalUsers / totalTxns);
            mevToxicityScore = Math.max(0, Math.min(100, botRatio * 100));
        } else if (totalTxns > 0 && totalUsers === 0) {
            mevToxicityScore = 100; // purely synthetic volume
        }

        // --- NEW: FDV Fragility ---
        const fdvRatio = tvl > 0 && fdv > 0 ? (fdv / tvl) : 0;
        const isFragile = fdvRatio > 100 || mevToxicityScore > 80;

        const isHealthy = tvl > 10000 && capitalEfficiency > 0.01 && slippagePercent < 5 && !isFragile;

        return {
            pool_name: pool.name,
            pool_created_at: pool.pool_created_at,
            pool_age_days: parseFloat(ageDays.toFixed(1)),
            fully_diluted_valuation_usd: fdv,
            total_value_locked_usd: tvl,
            volume_24h_usd: volume24h,
            price_change_24h_percentage: priceChange24h,
            transactions_24h: {
                total_transactions: totalTxns,
                buys: txns.buys,
                sells: txns.sells,
                unique_buyers: txns.buyers,
                unique_sellers: txns.sellers,
                buy_sell_ratio: parseFloat(buySellRatio.toFixed(2))
            },
            
            // Restored existing object exactly as it was
            liquidity_metrics: {
                capital_efficiency_score: parseFloat(capitalEfficiency.toFixed(4)),
                estimated_yearly_apy: parseFloat(estimatedApy.toFixed(2)),
                is_healthy_liquidity: isHealthy
            },
            
            // Brand NEW upgrades kept at top-level so you can add descriptions
            simulated_5k_slippage_percent: parseFloat(slippagePercent.toFixed(2)),
            mev_toxicity_score: parseFloat(mevToxicityScore.toFixed(2)),
            fdv_to_tvl_ratio: parseFloat(fdvRatio.toFixed(2)),
            is_fragile_liquidity: isFragile,

            summary: `Deep Audit completed for ${pool.name}. Pool is ${ageDays.toFixed(1)} days old with $${(tvl / 1000000).toFixed(2)}M TVL. MEV Toxicity Score: ${mevToxicityScore.toFixed(0)}/100. Simulated $5k trade slippage: ${slippagePercent.toFixed(2)}%.`
        };
    } catch (error) {
        throw new Error(`Failed to audit pool on GeckoTerminal: ${error.message}`);
    }
}

/**
 * Service 3: Yield Route Finder
 * Finds the top 3 pools for a given token based on volume and depth.
 */
async function findTopYieldRoutes(network, tokenAddress) {
    try {
        const res = await axios.get(`${BASE_URL}/networks/${network}/tokens/${tokenAddress}/pools`);
        const pools = res.data.data || [];

        if (pools.length === 0) {
            return {
                summary: "No liquidity pools found for this token on the specified network.",
                routes: []
            };
        }

        // Rank pools by True APY
        const sortedPools = pools
            .map(p => {
                const tvl = parseFloat(p.attributes.reserve_in_usd) || 0;
                const vol = parseFloat(p.attributes.volume_usd?.h24) || 0;
                const apy = tvl > 0 ? ((vol * 0.003 * 365) / tvl) * 100 : 0;
                const capitalVelocity = tvl > 0 ? (vol / tvl) : 0;
                return {
                    pool_address: p.attributes.address,
                    dex: p.relationships && p.relationships.dex && p.relationships.dex.data ? p.relationships.dex.data.id : "unknown",
                    name: p.attributes.name,
                    pool_age_days: parseFloat(((Date.now() - new Date(p.attributes.pool_created_at).getTime()) / (1000 * 60 * 60 * 24)).toFixed(1)),
                    tvl_usd: tvl,
                    volume_24h_usd: vol,
                    estimated_yearly_apy: parseFloat(apy.toFixed(2)),
                    capital_velocity: parseFloat(capitalVelocity.toFixed(4))
                };
            })
            .filter(p => p.tvl_usd > 1000) // Filter out dust pools
            .sort((a, b) => b.estimated_yearly_apy - a.estimated_yearly_apy) // Sort by APY, not Volume
            .slice(0, 3); // Top 3

        // Build a highly readable object format to avoid arrays but maintain clean JSON
        const routesObj = {};
        sortedPools.forEach((pool, index) => {
            routesObj[`route_${index + 1}`] = `DEX: ${pool.dex} | Pool: ${pool.name} | Address: ${pool.pool_address} | TVL: $${pool.tvl_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })} | True APY: ${pool.estimated_yearly_apy}% | Cap Velocity: ${pool.capital_velocity}`;
        });

        return {
            summary: "Scanned all DEXes. Found " + sortedPools.length + " viable high-volume liquidity routes.",
            routes: routesObj
        };
    } catch (error) {
        throw new Error(`Failed to find yield routes on GeckoTerminal: ${error.message}`);
    }
}

/**
 * Pre-Negotiation Validation Check
 * Lightweight check to ensure the pool or token exists on GeckoTerminal before accepting the job.
 */
async function validateResource(network, address, isToken = false) {
    try {
        const endpoint = isToken ? `tokens/${address}/pools` : `pools/${address}`;
        await axios.get(`${BASE_URL}/networks/${network}/${endpoint}`);
        return true;
    } catch (error) {
        return false;
    }
}

module.exports = {
    auditPool,
    findTopYieldRoutes,
    validateResource
};
