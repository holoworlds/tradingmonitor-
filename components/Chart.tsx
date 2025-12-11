
import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import { Candle, AlertLog } from '../types';

interface ChartProps {
  data: Candle[];
  logs: AlertLog[];
  symbol: string;
  interval: string;
}

// Tooltip/Legend Component
const ChartLegend = ({ 
  symbol, 
  interval, 
  ohlc, 
  indicators 
}: { 
  symbol: string, 
  interval: string, 
  ohlc: { open: string, high: string, low: string, close: string, color: string } | null,
  indicators: { ema7?: string, ema25?: string, ema99?: string } | null
}) => {
  if (!ohlc) {
    return (
      <div className="absolute top-3 left-3 z-20 bg-white/90 p-2 rounded border border-slate-200 shadow-sm text-xs font-mono backdrop-blur-sm">
         <span className="font-bold text-slate-900">{symbol} · {interval}</span>
      </div>
    );
  }

  return (
    <div className="absolute top-3 left-3 z-20 bg-white/90 p-2 rounded border border-slate-200 shadow-sm text-xs font-mono backdrop-blur-sm pointer-events-none">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-bold text-lg text-slate-900 leading-none">{symbol}</span>
        <span className="text-slate-500">{interval}</span>
      </div>
      <div className="flex gap-3 text-[11px]">
        <span className={ohlc.color}>O: {ohlc.open}</span>
        <span className={ohlc.color}>H: {ohlc.high}</span>
        <span className={ohlc.color}>L: {ohlc.low}</span>
        <span className={ohlc.color}>C: {ohlc.close}</span>
      </div>
      {indicators && (
        <div className="flex gap-3 mt-1 text-[10px]">
          {indicators.ema7 && <span className="text-yellow-600">EMA7: {indicators.ema7}</span>}
          {indicators.ema25 && <span className="text-blue-600">EMA25: {indicators.ema25}</span>}
          {indicators.ema99 && <span className="text-purple-600">EMA99: {indicators.ema99}</span>}
        </div>
      )}
    </div>
  );
};

const Chart: React.FC<ChartProps> = ({ data, logs, symbol, interval }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  
  // Series Refs
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ema7SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema25SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema99SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  // Tooltip State
  const [currentOHLC, setCurrentOHLC] = useState<any>(null);
  const [currentIndicators, setCurrentIndicators] = useState<any>(null);

  // Initialization
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 1. Create Chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: 'Solid' as any, color: '#ffffff' }, // 'Solid' corresponds to ColorType.Solid
        textColor: '#334155', // slate-700
      },
      grid: {
        vertLines: { color: '#f1f5f9' }, // slate-100
        horzLines: { color: '#f1f5f9' },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      crosshair: {
        mode: 0 as any, // 0 corresponds to CrosshairMode.Normal
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#e2e8f0',
      },
      rightPriceScale: {
        borderColor: '#e2e8f0',
      },
    });

    chartRef.current = chart;

    // 2. Create Series
    // Candlesticks
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981', // emerald-500
      downColor: '#f43f5e', // rose-500
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
    });
    candleSeriesRef.current = candleSeries;

    // EMAs
    const ema7 = chart.addLineSeries({ color: '#eab308', lineWidth: 1, crosshairMarkerVisible: false }); // yellow-500
    const ema25 = chart.addLineSeries({ color: '#3b82f6', lineWidth: 1, crosshairMarkerVisible: false }); // blue-500
    const ema99 = chart.addLineSeries({ color: '#a855f7', lineWidth: 2, crosshairMarkerVisible: false }); // purple-500
    
    ema7SeriesRef.current = ema7;
    ema25SeriesRef.current = ema25;
    ema99SeriesRef.current = ema99;

    // 3. Handle Crosshair Move (Legend Updates)
    chart.subscribeCrosshairMove((param) => {
      if (
        param.point === undefined ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > chartContainerRef.current!.clientWidth ||
        param.point.y < 0 ||
        param.point.y > chartContainerRef.current!.clientHeight
      ) {
        // Fallback to last candle data when mouse leaves
        // We will handle this in the data update effect to ensure we always have something
        return;
      }

      // Get Data at Crosshair
      const candleData = param.seriesData.get(candleSeries) as any;
      const e7 = param.seriesData.get(ema7) as any;
      const e25 = param.seriesData.get(ema25) as any;
      const e99 = param.seriesData.get(ema99) as any;

      if (candleData) {
        setCurrentOHLC({
          open: candleData.open.toFixed(2),
          high: candleData.high.toFixed(2),
          low: candleData.low.toFixed(2),
          close: candleData.close.toFixed(2),
          color: candleData.close >= candleData.open ? 'text-emerald-600' : 'text-rose-500'
        });
        setCurrentIndicators({
          ema7: e7?.value?.toFixed(2),
          ema25: e25?.value?.toFixed(2),
          ema99: e99?.value?.toFixed(2)
        });
      }
    });

    // 4. Resize Observer
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ 
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []); // Run once on mount

  // Update Data
  useEffect(() => {
    if (!chartRef.current || data.length === 0) return;

    // Prepare Data (Lightweight Charts uses seconds for Unix timestamps)
    const candleData = data.map(d => ({
      time: (d.time / 1000) as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close
    }));

    const ema7Data = data.map(d => d.ema7 ? ({ time: (d.time / 1000) as Time, value: d.ema7 }) : null).filter(Boolean);
    const ema25Data = data.map(d => d.ema25 ? ({ time: (d.time / 1000) as Time, value: d.ema25 }) : null).filter(Boolean);
    const ema99Data = data.map(d => d.ema99 ? ({ time: (d.time / 1000) as Time, value: d.ema99 }) : null).filter(Boolean);

    // Update Series
    candleSeriesRef.current?.setData(candleData);
    ema7SeriesRef.current?.setData(ema7Data as any);
    ema25SeriesRef.current?.setData(ema25Data as any);
    ema99SeriesRef.current?.setData(ema99Data as any);

    // Update Markers (Buy/Sell signals)
    const markers = logs.map(log => {
      // Find exact candle time or closest previous
      const logTimeSec = log.timestamp / 1000;
      // We need to match it to a valid candle time in the series
      // Find the closest candle time that is <= log time
      const closestCandle = data.slice().reverse().find(c => c.time <= log.timestamp);
      
      if (!closestCandle) return null;
      
      const isBuy = log.payload.action === 'buy' || log.payload.action === 'buy_to_cover';
      const text = isBuy ? 'B' : 'S';
      
      return {
        time: (closestCandle.time / 1000) as Time,
        position: isBuy ? 'belowBar' : 'aboveBar',
        color: isBuy ? '#10b981' : '#f43f5e',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        text: text,
        size: 1, // default size
      };
    }).filter(Boolean);

    // Remove duplicates (multiple buys on same candle can overlap, we just show last or all? TVLC supports multiple)
    // TVLC requires markers to be sorted by time
    // We trust logs are sorted or we sort them, but mapping to candle time might create dupes.
    // Let's sort markers by time.
    const sortedMarkers = (markers as any[]).sort((a, b) => (a.time as number) - (b.time as number));
    candleSeriesRef.current?.setMarkers(sortedMarkers);

    // Set Default Legend Data (Latest Candle)
    const last = data[data.length - 1];
    setCurrentOHLC({
      open: last.open.toFixed(2),
      high: last.high.toFixed(2),
      low: last.low.toFixed(2),
      close: last.close.toFixed(2),
      color: last.close >= last.open ? 'text-emerald-600' : 'text-rose-500'
    });
    setCurrentIndicators({
       ema7: last.ema7?.toFixed(2),
       ema25: last.ema25?.toFixed(2),
       ema99: last.ema99?.toFixed(2)
    });

  }, [data, logs]); // Re-run when data changes

  // Re-fit chart if symbol/interval changes significantly
  useEffect(() => {
    if(chartRef.current && data.length > 0) {
       chartRef.current.timeScale().fitContent();
    }
  }, [symbol, interval]);

  if (data.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <div className="text-xs">
             正在加载 {symbol} ({interval}) 数据...
          </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full group">
      <ChartLegend symbol={symbol} interval={interval} ohlc={currentOHLC} indicators={currentIndicators} />
      <div ref={chartContainerRef} className="w-full h-full" />
    </div>
  );
};

export default Chart;
