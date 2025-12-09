
import fs from 'fs';
import path from 'path';
import { Candle } from '../types';

// Ensure data directory exists
const DATA_DIR = path.resolve('data');
if (!fs.existsSync(DATA_DIR)) {
    try {
        fs.mkdirSync(DATA_DIR);
    } catch (e) {
        console.error('[FileStore] Failed to create data directory', e);
    }
}

export const FileStore = {
    load: (key: string): Candle[] => {
        const filePath = path.join(DATA_DIR, `${key}.json`);
        if (fs.existsSync(filePath)) {
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const data = JSON.parse(raw);
                if (Array.isArray(data)) {
                    return data;
                }
            } catch (e) {
                console.error(`[FileStore] Error loading ${key}`, e);
            }
        }
        return [];
    },

    save: (key: string, data: Candle[]) => {
        const filePath = path.join(DATA_DIR, `${key}.json`);
        try {
            // Optimization: In a real DB we wouldn't write the whole array every time.
            // For JSON files, we overwrite.
            fs.writeFileSync(filePath, JSON.stringify(data));
        } catch (e) {
            console.error(`[FileStore] Error saving ${key}`, e);
        }
    }
};
