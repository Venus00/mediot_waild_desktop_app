import { useEffect, useRef, memo } from 'react';

interface TimestampedData {
    timestamp: number;
    value: number;
}

interface ChartProps {
    data: TimestampedData[];
    color: string;
    title: string;
    width?: number;
    height?: number;
    className?: string;
    timeWindowMs?: number; // Fixed time window in milliseconds
    min?: number; // Optional fixed min value for scaling
    max?: number; // Optional fixed max value for scaling
}

const Chart = memo<ChartProps>(({
    data,
    color,
    title,
    width = 800,
    height = 150,
    className = "",
    timeWindowMs = 5000, // Default 5 second window
    min,
    max
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameRef = useRef<number>();

    useEffect(() => {
        // OPTIMIZED: Use requestAnimationFrame for smooth rendering
        const render = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            // Set canvas size for crisp rendering
            const dpr = window.devicePixelRatio || 1;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            ctx.scale(dpr, dpr);

            ctx.clearRect(0, 0, width, height);

            // If no data, show empty chart
            if (data.length === 0) {
                ctx.fillStyle = color;
                ctx.font = '12px Arial';
                ctx.fillText(`${title} - No Data`, 10, 15);
                return;
            }

            // OPTIMIZED: Calculate time-based positioning with smart timeline management
            const latestTimestamp = Math.max(...data.map((d: TimestampedData) => d.timestamp));
            const now = Date.now();
            const dataAge = (now - latestTimestamp) / 1000;

            let windowStart: number;
            let windowEnd: number;
            let visibleData: TimestampedData[];

            // Smart window positioning based on data freshness
            if (dataAge < 2 && data.length > 0) {
                // LIVE DATA: Use real-time scrolling window
                windowEnd = now;
                windowStart = now - timeWindowMs;
                visibleData = data.filter((point: TimestampedData) => point.timestamp >= windowStart && point.timestamp <= windowEnd);
            } else {
                // PAUSED DATA: Show ALL available data
                visibleData = data;
                const allTimestamps = data.map((d: TimestampedData) => d.timestamp);
                const oldestData = Math.min(...allTimestamps);
                const newestData = Math.max(...allTimestamps);
                const timeSpan = newestData - oldestData;
                const padding = Math.max(timeSpan * 0.02, 1000);
                windowStart = oldestData - padding;
                windowEnd = newestData + padding;
            }

            if (visibleData.length === 0) {
                ctx.fillStyle = color;
                ctx.font = '12px Arial';
                ctx.fillText(`${title} - No Data`, 10, 15);
                return;
            }

            // OPTIMIZED: Use fixed scaling if min/max provided, otherwise auto-scale
            const values = visibleData.map(d => d.value);
            const minValue = min !== undefined ? min : Math.min(...values);
            const maxValue = max !== undefined ? max : Math.max(...values);
            const range = maxValue - minValue || 1;
            const padding = range * 0.1;

            // Calculate pixels per ms
            const actualTimeWindow = windowEnd - windowStart;
            const adjustedPixelsPerMs = width / actualTimeWindow;

            // OPTIMIZED: Draw the line chart with path for better performance
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();

            let firstPoint = true;
            visibleData.forEach((dataPoint: TimestampedData) => {
                const x = (dataPoint.timestamp - windowStart) * adjustedPixelsPerMs;
                const normalizedY = (dataPoint.value - minValue + padding) / (range + 2 * padding);
                const y = height - (normalizedY * height);

                if (firstPoint) {
                    ctx.moveTo(x, y);
                    firstPoint = false;
                } else {
                    ctx.lineTo(x, y);
                }
            });

            ctx.stroke();

            // OPTIMIZED: Draw grid with reduced opacity for better performance
            ctx.strokeStyle = color.replace('rgb(', 'rgba(').replace(')', ', 0.1)');
            ctx.lineWidth = 1;
            for (let i = 0; i < width; i += 80) {
                ctx.beginPath();
                ctx.moveTo(i, 0);
                ctx.lineTo(i, height);
                ctx.stroke();
            }
            for (let i = 0; i < height; i += 40) {
                ctx.beginPath();
                ctx.moveTo(0, i);
                ctx.lineTo(width, i);
                ctx.stroke();
            }

            // Draw labels
            ctx.fillStyle = color;
            ctx.font = '12px Arial';
            ctx.fillText(`${title}`, 10, 15);
            ctx.fillText(`Min: ${minValue.toFixed(0)}`, 10, 30);
            ctx.fillText(`Max: ${maxValue.toFixed(0)}`, 10, 45);
            if (visibleData.length > 0) {
                ctx.fillText(`Current: ${visibleData[visibleData.length - 1].value.toFixed(0)}`, 10, 60);
            }
        };

        // Use requestAnimationFrame for smooth rendering
        animationFrameRef.current = requestAnimationFrame(render);

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [data, color, title, timeWindowMs, width, height, min, max]);

    return (
        <canvas
            ref={canvasRef}
            style={{ width: `${width}px`, height: `${height}px` }}
            className={className}
        />
    );
});

Chart.displayName = 'Chart';

export default Chart;