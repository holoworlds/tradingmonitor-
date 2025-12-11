
import React, { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { Candle, AlertLog } from '../types';

interface ChartProps {
  data: Candle[];
  logs: AlertLog[];
  symbol: string;
  interval: string;
}

const Chart: React.FC<ChartProps> = ({ data, logs, symbol, interval }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>({});

  // Tooltip State
  const [legend, setLegend] = useState<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: { 
        background: { type: 'solid', color: '#ffffff' }, 
        textColor: '#334155' 
      },
      grid: { 
        vertLines: { color: '#f1f5f9' }, 
        horzLines: { color: '#f1f5f9' } 
      },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#e2e8f0',
      },
      rightPriceScale: {
        borderColor: '#e2e8f0',
      },
      crosshair: {
        mode: 1, // Normal
      }
    });

    // 1. Candlestick Series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981', 
      downColor: '#f43f5e', 
      borderVisible: false, 
      wickUpColor: '#10b981', 
      wickDownColor: '#f43f5e' 
    });

    // 2. EMA Series
    const ema7 = chart.addLineSeries({ color: '#eab308', lineWidth: 1, crosshairMarkerVisible: false });
    const ema25 = chart.addLineSeries({ color: '#3b82f6', lineWidth: 1, crosshairMarkerVisible: false });
    const ema99 = chart.addLineSeries({ color: '#a855f7', lineWidth: 2, crosshairMarkerVisible: false });

    seriesRef.current = { candleSeries, ema7, ema25, ema99 };
    chartRef.current = chart;

    // Crosshair Handler for Legend
    chart.subscribeCrosshairMove((param: any) => {
        if (!param.point || !param.time) {
            return;
        }
        const candleData = param.seriesData.get(candleSeries);
        const e7 = param.seriesData.get(ema7);
        const e25 = param.seriesData.get(ema25);
        const e99 = param.seriesData.get(ema99);

        if (candleData) {
            setLegend({
                open: candleData.open.toFixed(2),
                high: candleData.high.toFixed(2),
                low: candleData.low.toFixed(2),
                close: candleData.close.toFixed(2),
                color: candleData.close >= candleData.open ? 'text-emerald-600' : 'text-rose-500',
                ema7: e7?.value?.toFixed(2),
                ema25: e25?.value?.toFixed(2),
                ema99: e99?.value?.toFixed(2)
            });
        }
    });

    const handleResize = () => {
        if(containerRef.current) {
            chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight });
        }
    };
    window.addEventListener('resize', handleResize);

    return () => {
        window.removeEventListener('resize', handleResize);
        chart.remove();
    };
  }, []);

  // Data Update Effect
  useEffect(() => {
    if (!chartRef.current || data.length === 0) return;

    // Convert timestamps to seconds (lightweight-charts requirement)
    // Note: We cast to 'any' to bypass strict TS type checks for simple implementation
    const candles = data.map(d => ({
        time: d.time / 1000,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close
    }));

    const e7 = data.map(d => d.ema7 ? ({ time: d.time / 1000, value: d.ema7 }) : null).filter(Boolean);
    const e25 = data.map(d => d.ema25 ? ({ time: d.time / 1000, value: d.ema25 }) : null).filter(Boolean);
    const e99 = data.map(d => d.ema99 ? ({ time: d.time / 1000, value: d.ema99 }) : null).filter(Boolean);

    seriesRef.current.candleSeries.setData(candles);
    seriesRef.current.ema7.setData(e7);
    seriesRef.current.ema25.setData(e25);
    seriesRef.current.ema99.setData(e99);

    // Markers (Buy/Sell Signals)
    const markers = logs.map(log => {
        // Find closest candle time
        const logTimeSec = Math.floor(log.timestamp / 1000);
        const matchedCandle = candles.find(c => c.time <= logTimeSec && c.time + 60 > logTimeSec) || candles[candles.length-1];
        
        if (!matchedCandle) return null;

        const isBuy = log.payload.action.includes('buy');
        return {
            time: matchedCandle.time,
            position: isBuy ? 'belowBar' : 'aboveBar',
            color: isBuy ? '#10b981' : '#f43f5e',
            shape: isBuy ? 'arrowUp' : 'arrowDown',
            text: isBuy ? 'B' : 'S',
        };
    }).filter(Boolean).sort((a: any, b: any) => a.time - b.time);

    seriesRef.current.candleSeries.setMarkers(markers);

    // Update Legend to latest
    const last = data[data.length - 1];
    setLegend({
        open: last.open.toFixed(2),
        high: last.high.toFixed(2),
        low: last.low.toFixed(2),
        close: last.close.toFixed(2),
        color: last.close >= last.open ? 'text-emerald-600' : 'text-rose-500',
        ema7: last.ema7?.toFixed(2),
        ema25: last.ema25?.toFixed(2),
        ema99: last.ema99?.toFixed(2)
    });

  }, [data, logs]);

  if (data.length === 0) return <div className="flex h-full items-center justify-center text-slate-400 text-xs">Loading Data...</div>;

  return (
    <div className="relative w-full h-full">
        {legend && (
            <div className="absolute top-3 left-3 z-20 bg-white/90 p-2 rounded border border-slate-200 shadow-sm text-xs font-mono backdrop-blur-sm pointer-events-none">
                <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-lg text-slate-900 leading-none">{symbol}</span>
                    <span className="text-slate-500">{interval}</span>
                </div>
                <div className="flex gap-3 text-[11px]">
                    <span className={legend.color}>O: {legend.open}</span>
                    <span className={legend.color}>H: {legend.high}</span>
                    <span className={legend.color}>L: {legend.low}</span>
                    <span className={legend.color}>C: {legend.close}</span>
                </div>
                <div className="flex gap-3 mt-1 text-[10px]">
                    {legend.ema7 && <span className="text-yellow-600">EMA7: {legend.ema7}</span>}
                    {legend.ema25 && <span className="text-blue-600">EMA25: {legend.ema25}</span>}
                    {legend.ema99 && <span className="text-purple-600">EMA99: {legend.ema99}</span>}
                </div>
            </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};

export default Chart;
