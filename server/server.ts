
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { StrategyRunner } from './StrategyRunner';
import { DEFAULT_CONFIG } from '../constants';
import { StrategyConfig, StrategyRuntime } from '../types';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

const PORT = 3001;

// --- Server State ---
const strategies: Record<string, StrategyRunner> = {};
let logs: any[] = [];

// Initialize Default Strategy
const defaultRunner = new StrategyRunner(
    DEFAULT_CONFIG, 
    (id, runtime) => broadcastUpdate(id, runtime),
    (log) => addLog(log)
);
strategies[DEFAULT_CONFIG.id] = defaultRunner;
defaultRunner.start(); // Auto-start the default strategy

// --- Helper Functions ---

function broadcastUpdate(id: string, runtime: StrategyRuntime) {
    // Optimization: Broadcast state update to all clients
    io.emit('state_update', { id, runtime });
}

function broadcastFullState(socketId?: string) {
    const fullState: Record<string, StrategyRuntime> = {};
    Object.keys(strategies).forEach(id => {
        fullState[id] = strategies[id].runtime;
    });
    
    if (socketId) {
        io.to(socketId).emit('full_state', fullState);
        io.to(socketId).emit('logs_update', logs);
    } else {
        io.emit('full_state', fullState);
    }
}

function addLog(log: any) {
    logs = [log, ...logs].slice(0, 500); // Keep last 500
    io.emit('log_new', log);
}

// --- Socket.io Handlers ---

io.on('connection', (socket) => {
    console.log('Frontend Connected:', socket.id);

    // Send initial data
    broadcastFullState(socket.id);

    // Frontend requests to update config
    socket.on('cmd_update_config', ({ id, updates }: { id: string, updates: Partial<StrategyConfig> }) => {
        const runner = strategies[id];
        if (runner) {
            const newConfig = { ...runner.runtime.config, ...updates };
            runner.updateConfig(newConfig);
            console.log(`Updated config for ${id}`);
        }
    });

    // Frontend requests to add new strategy
    socket.on('cmd_add_strategy', () => {
        const newId = Math.random().toString(36).substr(2, 9);
        const newConfig = { ...DEFAULT_CONFIG, id: newId, name: `策略 #${Object.keys(strategies).length + 1}` };
        
        const newRunner = new StrategyRunner(
            newConfig,
            (id, runtime) => broadcastUpdate(id, runtime),
            (log) => addLog(log)
        );
        strategies[newId] = newRunner;
        newRunner.start();
        
        broadcastFullState();
    });

    // Frontend requests to remove strategy
    socket.on('cmd_remove_strategy', (id: string) => {
        if (strategies[id]) {
            strategies[id].stop();
            delete strategies[id];
            broadcastFullState();
        }
    });

    // Manual Orders
    socket.on('cmd_manual_order', ({ id, type }: { id: string, type: 'LONG'|'SHORT'|'FLAT' }) => {
        if (strategies[id]) {
            strategies[id].handleManualOrder(type);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Backend Strategy Server running on port ${PORT}`);
});
