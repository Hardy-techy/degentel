require('dotenv').config();
const { AgentClient } = require('@croo-network/sdk');
const { auditPool, findTopYieldRoutes, validateResource } = require('./services/pool-scanner');
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
    baseURL: process.env.CROO_API_URL,
    wsURL: process.env.CROO_WS_URL
}, process.env.CROO_SDK_KEY);

async function start() {
    try {
        const stream = await client.connectWebSocket();

        // Stage 1: Negotiate
        stream.on('order_negotiation_created', async (event) => {
            console.log(`[Degentel] Negotiation requested by ${event.requester_agent_id}`);
            try {
                // 1. Fetch negotiation details to get the input schema (requirements)
                const negotiation = await client.getNegotiation(event.negotiation_id);
                let requirements = {};
                try {
                    requirements = JSON.parse(negotiation.requirements);
                } catch (e) {
                    await client.rejectNegotiation(event.negotiation_id, "Invalid JSON requirements");
                    return;
                }

                const { network, target_liquidity_pool_address, target_token_address } = requirements;
                if (!network) {
                    await client.rejectNegotiation(event.negotiation_id, "Missing network");
                    return;
                }

                let networkStr;
                try {
                    networkStr = getNetworkString(network);
                } catch (e) {
                    await client.rejectNegotiation(event.negotiation_id, "Unsupported network");
                    return;
                }

                // 2. Validate the specific inputs against GeckoTerminal
                let isValid = false;
                if (target_liquidity_pool_address) {
                    isValid = await validateResource(networkStr, target_liquidity_pool_address, false);
                } else if (target_token_address) {
                    isValid = await validateResource(networkStr, target_token_address, true);
                } else {
                    await client.rejectNegotiation(event.negotiation_id, "Missing target address");
                    return;
                }

                // 3. Reject if invalid, saving agent completion % and user's money
                if (!isValid) {
                    console.log(`[Degentel] Rejected negotiation ${event.negotiation_id} due to invalid pool/token address on ${networkStr}`);
                    await client.rejectNegotiation(event.negotiation_id, `Invalid pool or token address on ${networkStr}`);
                    return;
                }

                // 4. Accept if everything looks good!
                await client.acceptNegotiation(event.negotiation_id);
                console.log(`[Degentel] Negotiation accepted. Waiting for on-chain escrow lock...`);
            } catch (error) {
                console.error(`[Degentel] Failed to handle negotiation:`, error);
            }
        });

        // Stage 2 & 3: Lock -> Deliver
        stream.on('order_paid', async (event) => {
            console.log(`[Degentel] Order ${event.order_id} locked on-chain. Routing to appropriate service...`);

            try {
                const order = await client.getOrder(event.order_id);
                const negotiation = await client.getNegotiation(order.negotiationId);

                let requirements = {};
                try {
                    requirements = JSON.parse(negotiation.requirements);
                } catch (e) {
                    throw new Error("Failed to parse JSON requirements: " + negotiation.requirements);
                }

                const { network, target_liquidity_pool_address, target_token_address } = requirements;

                if (!network) {
                    throw new Error("Invalid input: missing network");
                }

                const networkStr = getNetworkString(network);
                let payload;

                console.log(`[Degentel] Order ${event.order_id} belongs to Service ID: ${order.serviceId}`);

                // Route the request to the correct service logic based on Dashboard Service ID
                if (order.serviceId === process.env.CROO_SERVICE_IL_FORECAST) {
                    if (!target_liquidity_pool_address) throw new Error("Missing target_liquidity_pool_address");
                    console.log(`[Degentel] Executing IL Forecaster on ${networkStr} for ${target_liquidity_pool_address}`);
                    payload = await forecastImpermanentLoss(networkStr, target_liquidity_pool_address);

                } else if (order.serviceId === process.env.CROO_SERVICE_AUDIT) {
                    if (!target_liquidity_pool_address) throw new Error("Missing target_liquidity_pool_address");
                    console.log(`[Degentel] Executing Deep Liquidity Audit on ${networkStr} for ${target_liquidity_pool_address}`);
                    payload = await auditPool(networkStr, target_liquidity_pool_address);

                } else if (order.serviceId === process.env.CROO_SERVICE_ROUTE_FINDER) {
                    if (!target_token_address) throw new Error("Missing target_token_address");
                    console.log(`[Degentel] Executing Yield Route Finder on ${networkStr} for ${target_token_address}`);
                    payload = await findTopYieldRoutes(networkStr, target_token_address);

                } else {
                    throw new Error(`Unrecognized serviceId: ${order.serviceId}. Did you add it to .env?`);
                }

                // Deliver the order back to the CROO Protocol
                await client.deliverOrder(event.order_id, {
                    deliverableType: 'schema',
                    deliverableText: JSON.stringify(payload)
                });
                console.log(`[Degentel] Successfully fulfilled order ${event.order_id}. Settling on-chain.`);

            } catch (error) {
                console.error(`[Degentel] SLA Failure / Internal Error on Order ${event.order_id}:`, error);

                // Trigger on-chain refund if the service crashes
                try {
                    if (typeof client.rejectOrder === 'function') {
                        await client.rejectOrder(event.order_id, error.message || "Internal Server Error");
                        console.log(`[Degentel] Order ${event.order_id} safely rejected. Escrow refunded.`);
                    } else {
                        console.log(`[Degentel] Order ${event.order_id} failed. Escrow will auto-refund on timeout.`);
                    }
                } catch (rejectErr) {
                    console.error(`[Degentel] Failed to trigger on-chain refund for Order ${event.order_id}:`, rejectErr);
                }
            }
        });

        console.log(`🚀 Degentel LP connected to CROO Network via WebSocket.`);
        console.log(`✅ Waiting for incoming multi-service CAP orders...`);

    } catch (err) {
        console.error("Failed to start agent:", err);
    }
}

start();
