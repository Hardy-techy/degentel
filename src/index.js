require('dotenv').config();
const { AgentClient } = require('@croo-network/sdk');
const { auditPool, findTopYieldRoutes } = require('./services/pool-scanner');
const { forecastImpermanentLoss } = require('./services/il-math');

// Helper to map human-readable chain names to GeckoTerminal network
function getNetworkString(chainName) {
    const name = typeof chainName === 'string' ? chainName.toLowerCase().trim() : String(chainName);
    
    const map = {
        "ethereum": "eth",
        "eth": "eth",
        "base": "base",
        "arbitrum": "arbitrum",
        "arb": "arbitrum",
        "polygon": "polygon",
        "matic": "polygon",
        "bsc": "bsc",
        "binance": "bsc",
        "binance smart chain": "bsc",
        "solana": "solana",
        "sol": "solana"
    };

    if (!map[name]) {
        throw new Error(`Unrecognized network: '${chainName}'. Please use a supported chain: ethereum, base, bsc, solana, arbitrum, or polygon.`);
    }

    return map[name];
}

const client = new AgentClient({
    apiUrl: process.env.CROO_API_URL,
    wsUrl: process.env.CROO_WS_URL,
    apiKey: process.env.CROO_SDK_KEY
});

// Stage 1: Negotiate
client.on('negotiation_requested', async (negotiation) => {
    console.log(`[Degentel] Negotiation requested by ${negotiation.requester}`);
    try {
        await client.acceptNegotiation(negotiation.id);
        console.log(`[Degentel] Negotiation accepted. Waiting for on-chain escrow lock...`);
    } catch (error) {
        console.error(`[Degentel] Failed to accept negotiation:`, error);
    }
});

// Stage 2 & 3: Lock -> Deliver
client.on('order_created', async (order) => {
    console.log(`[Degentel] Order ${order.id} locked on-chain. Routing to appropriate service...`);
    
    try {
        const { network, target_liquidity_pool_address, target_token_address } = order.requirements;

        if (!network) {
            throw new Error("Invalid input: missing network");
        }

        const networkStr = getNetworkString(network);
        let payload = { status: "success" };

        console.log(`[Degentel] Order ${order.id} belongs to Service ID: ${order.serviceId}`);

        // Route the request to the correct service logic based on Dashboard Service ID
        if (order.serviceId === process.env.CROO_SERVICE_IL_FORECAST) {
            if (!target_liquidity_pool_address) throw new Error("Missing target_liquidity_pool_address");
            console.log(`[Degentel] Executing IL Forecaster on ${networkStr} for ${target_liquidity_pool_address}`);
            const result = await forecastImpermanentLoss(networkStr, target_liquidity_pool_address);
            payload = { ...payload, ...result };
        
        } else if (order.serviceId === process.env.CROO_SERVICE_AUDIT) {
            if (!target_liquidity_pool_address) throw new Error("Missing target_liquidity_pool_address");
            console.log(`[Degentel] Executing Deep Liquidity Audit on ${networkStr} for ${target_liquidity_pool_address}`);
            const result = await auditPool(networkStr, target_liquidity_pool_address);
            payload = { ...payload, ...result };
            
        } else if (order.serviceId === process.env.CROO_SERVICE_ROUTE_FINDER) {
            if (!target_token_address) throw new Error("Missing target_token_address");
            console.log(`[Degentel] Executing Yield Route Finder on ${networkStr} for ${target_token_address}`);
            const result = await findTopYieldRoutes(networkStr, target_token_address);
            payload = { ...payload, ...result };
            
        } else {
            throw new Error(`Unrecognized serviceId: ${order.serviceId}. Did you add it to .env?`);
        }

        // Deliver the order back to the CROO Protocol
        await client.deliverOrder(order.id, payload);
        console.log(`[Degentel] Successfully fulfilled order ${order.id}. Settling on-chain.`);

    } catch (error) {
        console.error(`[Degentel] SLA Failure / Internal Error on Order ${order.id}:`, error);
        
        // Trigger on-chain refund if the service crashes
        try {
            if (typeof client.rejectOrder === 'function') {
                await client.rejectOrder(order.id, error.message || "Internal Server Error");
                console.log(`[Degentel] Order ${order.id} safely rejected. Escrow refunded.`);
            } else {
                console.log(`[Degentel] Order ${order.id} failed. Escrow will auto-refund on timeout.`);
            }
        } catch (rejectErr) {
            console.error(`[Degentel] Failed to trigger on-chain refund for Order ${order.id}:`, rejectErr);
        }
    }
});

// Start the agent
client.connect().then(() => {
    console.log(`🚀 Degentel LP connected to CROO Network via WebSocket.`);
    console.log(`✅ Waiting for incoming multi-service CAP orders...`);
}).catch(err => {
    console.error("Failed to connect to CROO network:", err);
});

