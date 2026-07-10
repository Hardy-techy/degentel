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

        const isHealthy = tvl > 10000 && capitalEfficiency > 0.01;

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
            liquidity_metrics: {
                capital_efficiency_score: parseFloat(capitalEfficiency.toFixed(4)),
                estimated_yearly_apy: parseFloat(estimatedApy.toFixed(2)),
                is_healthy_liquidity: isHealthy
            },
            summary: `Deep Audit completed for ${pool.name}. Pool is ${ageDays.toFixed(1)} days old with $${(tvl/1000000).toFixed(2)}M TVL. Saw ${totalTxns} transactions in the last 24h. Capital efficiency yields an estimated ${estimatedApy.toFixed(2)}% APY.`
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

        // Rank pools by 24h volume
        const sortedPools = pools
            .map(p => {
                const tvl = parseFloat(p.attributes.reserve_in_usd) || 0;
                const vol = parseFloat(p.attributes.volume_usd?.h24) || 0;
                const apy = tvl > 0 ? ((vol * 0.003 * 365) / tvl) * 100 : 0;
                return {
                    pool_address: p.attributes.address,
                    dex: p.relationships && p.relationships.dex && p.relationships.dex.data ? p.relationships.dex.data.id : "unknown",
                    name: p.attributes.name,
                    pool_age_days: parseFloat(((Date.now() - new Date(p.attributes.pool_created_at).getTime()) / (1000 * 60 * 60 * 24)).toFixed(1)),
                    tvl_usd: tvl,
                    volume_24h_usd: vol,
                    estimated_yearly_apy: parseFloat(apy.toFixed(2))
                };
            })
            .filter(p => p.tvl_usd > 1000) // Filter out dust pools
            .sort((a, b) => b.volume_24h_usd - a.volume_24h_usd)
            .slice(0, 3); // Top 3

        // Build a highly readable, beautiful text output
        let routesString = "";
        sortedPools.forEach((pool, index) => {
            routesString += `${index + 1}. ${pool.name} (${pool.dex})\n`;
            routesString += `   Pool Address: ${pool.pool_address}\n`;
            routesString += `   TVL: $${pool.tvl_usd.toLocaleString(undefined, {maximumFractionDigits: 0})} | 24h Vol: $${pool.volume_24h_usd.toLocaleString(undefined, {maximumFractionDigits: 0})} | Est. APY: ${pool.estimated_yearly_apy}%\n\n`;
        });

        return {
            summary: "Scanned all DEXes. Found " + sortedPools.length + " viable high-volume liquidity routes.",
            routes: routesString.trim()
        };
    } catch (error) {
        throw new Error(`Failed to find yield routes on GeckoTerminal: ${error.message}`);
    }
}

module.exports = {
    auditPool,
    findTopYieldRoutes
};
