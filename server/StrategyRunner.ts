import WebSocket from 'ws';
import { StrategyConfig, StrategyRuntime, Candle, PositionState, TradeStats, WebhookPayload } from "../types";
import { fetchHistoricalCandles, parseSocketMessage } from "../services/binanceService";
import { enrichCandlesWithIndicators } from "../services/indicatorService";
import { evaluateStrategy } from "../services/strategyEngine";
import { BINANCE_WS_BASE } from "../constants";

const INITIAL_POS_STATE: PositionState = {
    direction: 'FLAT', 
    initialQuantity: 0,
    remainingQuantity: 0,
    entryPrice: 0, 
    highestPrice: 0, 
    lowestPrice: 0, 
    openTime: 0, 
    tpLevelsHit: [], 
    slLevelsHit: []
};

const INITIAL_STATS: TradeStats = { dailyTradeCount: 0, lastTradeDate: new Date().toISOString().split('T')[0] };

export class StrategyRunner {
    public runtime: StrategyRuntime;
    private ws: WebSocket | null = null;
    private pingInterval: ReturnType<typeof setInterval> | null = null;
    private isConnected: boolean = false;
    private onUpdate: (id: string, runtime: StrategyRuntime) => void;
    private onLog: (log: any) => void;

    constructor(config: StrategyConfig, onUpdate: (id: string, runtime: StrategyRuntime) => void, onLog: (log: any) => void) {
        this.onUpdate = onUpdate;
        this.onLog = onLog;
        this.runtime = {
            config: config,
            candles: [],
            positionState: INITIAL_POS_STATE,
            tradeStats: INITIAL_STATS,
            lastPrice: 0
        };
    }

    public async start() {
        console.log(`[${this.runtime.config.name}] Starting...`);
        // 1. Fetch Historical Data
        const history = await fetchHistoricalCandles(this.runtime.config.symbol, this.runtime.config.interval);
        this.runtime.candles = enrichCandlesWithIndicators(history, {
            macdFast: this.runtime.config.macdFast,
            macdSlow: this.runtime.config.macdSlow,
            macdSignal: this.runtime.config.macdSignal
        });
        if (history.length > 0) {
            this.runtime.lastPrice = history[history.length - 1].close;
        }
        
        // 2. Connect to WebSocket
        this.connectWebSocket();
    }

    public stop() {
        console.log(`[${this.runtime.config.name}] Stopping...`);
        if (this.ws) {
            this.ws.terminate();
            this.ws = null;
        }
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }
        this.isConnected = false;
    }

    public updateConfig(newConfig: StrategyConfig) {
        const oldSymbol = this.runtime.config.symbol;
        const oldInterval = this.runtime.config.interval;
        
        this.runtime.config = newConfig;

        // If symbol or interval changed, restart connection and data
        if (newConfig.symbol !== oldSymbol || newConfig.interval !== oldInterval) {
            this.stop();
            this.runtime.candles = [];
            this.start();
        } else {
            // Just trigger an update to ensure UI sees new config
            this.emitUpdate();
        }
    }

    public handleManualOrder(type: 'LONG' | 'SHORT' | 'FLAT') {
        const price = this.runtime.lastPrice;
        if (price === 0) return;

        const now = new Date();
        let act = '';
        let pos = '';
        let quantity = 0;
        let tradeAmount = 0;

        if (type === 'LONG') { 
            act = 'buy'; 
            pos = 'long'; 
            tradeAmount = this.runtime.config.tradeAmount;
            quantity = tradeAmount / price;
        }
        if (type === 'SHORT') { 
            act = 'sell'; 
            pos = 'short'; 
            tradeAmount = this.runtime.config.tradeAmount;
            quantity = tradeAmount / price;
        }
        if (type === 'FLAT') { 
            act = this.runtime.positionState.direction === 'LONG' ? 'sell' : 'buy_to_cover'; 
            pos = 'flat'; 
            quantity = this.runtime.positionState.remainingQuantity; 
            tradeAmount = quantity * price; 
        }

        const payload: WebhookPayload = {
            secret: this.runtime.config.secret,
            action: act,
            position: pos,
            symbol: this.runtime.config.symbol,
            trade_amount: tradeAmount, // Keeping for compatibility if needed
            leverage: 5,
            timestamp: now.toISOString(),
            tv_exchange: "BINANCE",
            strategy_name: "Manual_Override",
            tp_level: "手动操作",
            execution_price: price,
            execution_quantity: quantity
        };

        // Update State Manually
        let newStats = { ...this.runtime.tradeStats };
        let newState: PositionState;

        if (type === 'FLAT') {
            newState = INITIAL_POS_STATE;
        } else {
            newState = {
                direction: type,
                initialQuantity: quantity,
                remainingQuantity: quantity,
                entryPrice: price,
                highestPrice: type === 'LONG' ? price : 0,
                lowestPrice: type === 'SHORT' ? price : 0,
                openTime: now.getTime(),
                tpLevelsHit: [],
                slLevelsHit: []
            };
            newStats.dailyTradeCount += 1;
        }

        this.runtime.positionState = newState;
        this.runtime.tradeStats = newStats;

        this.sendWebhook(payload, true);
        this.emitUpdate();
    }

    private connectWebSocket() {
        const streamName = `${this.runtime.config.symbol.toLowerCase()}@kline_${this.runtime.config.interval}`;
        const wsUrl = `${BINANCE_WS_BASE}${streamName}`;
        
        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
            console.log(`[${this.runtime.config.name}] WS Connected`);
            this.isConnected = true;
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.data) {
                    const kline = parseSocketMessage(msg.data);
                    if (kline) {
                        this.processCandle(kline);
                    }
                }
            } catch (e) {
                console.error(`[${this.runtime.config.name}] WS Error parsing`, e);
            }
        });

        this.ws.on('close', () => {
            console.log(`[${this.runtime.config.name}] WS Closed. Reconnecting in 5s...`);
            this.isConnected = false;
            setTimeout(() => this.start(), 5000); // Simple reconnect
        });

        this.ws.on('error', (err) => {
            console.error(`[${this.runtime.config.name}] WS Error`, err);
        });
    }

    private processCandle(newCandle: Candle) {
        this.runtime.lastPrice = newCandle.close;

        // 1. Update Candle List
        let updatedCandles = [...this.runtime.candles];
        const lastCandle = updatedCandles[updatedCandles.length - 1];

        if (lastCandle && lastCandle.time === newCandle.time) {
            updatedCandles[updatedCandles.length - 1] = newCandle;
        } else {
            updatedCandles.push(newCandle);
        }
        
        // Keep buffer size reasonable
        if (updatedCandles.length > 550) updatedCandles = updatedCandles.slice(-550);

        // 2. Enrich
        const enriched = enrichCandlesWithIndicators(updatedCandles, {
            macdFast: this.runtime.config.macdFast,
            macdSlow: this.runtime.config.macdSlow,
            macdSignal: this.runtime.config.macdSignal
        });
        this.runtime.candles = enriched;

        // 3. Evaluate Strategy
        const result = evaluateStrategy(
            enriched, 
            this.runtime.config, 
            this.runtime.positionState, 
            this.runtime.tradeStats
        );

        // 4. Update State
        this.runtime.positionState = result.newPositionState;
        this.runtime.tradeStats = result.newTradeStats;

        // 5. Execute Actions
        if (result.actions.length > 0) {
            result.actions.forEach(action => this.sendWebhook(action));
        }

        // 6. Notify Manager
        this.emitUpdate();
    }

    private async sendWebhook(payload: WebhookPayload, isManual: boolean = false) {
        // Log it first
        const logEntry = {
            id: Math.random().toString(36).substr(2, 9),
            strategyId: this.runtime.config.id,
            strategyName: this.runtime.config.name,
            timestamp: Date.now(),
            payload,
            status: 'sent',
            type: isManual ? 'Manual' : 'Strategy'
        };
        this.onLog(logEntry);

        // Actual HTTP Request
        const url = this.runtime.config.webhookUrl;
        if (url) {
            try {
                await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                console.log(`[${this.runtime.config.name}] Webhook Sent: ${payload.action}`);
            } catch (e) {
                console.error(`[${this.runtime.config.name}] Webhook Failed`, e);
            }
        }
    }

    private emitUpdate() {
        this.onUpdate(this.runtime.config.id, this.runtime);
    }
}