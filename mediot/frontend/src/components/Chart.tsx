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
    width = 980,
    height = 140,
    className = "",
    timeWindowMs = 10000, // 10 second scrolling window for medical charts
    min,
    max
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameRef = useRef<number>();

    useEffect(() => {
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

            // MEDICAL CHART: Always show chart with grid, even with no data
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, width, height);

            // Draw medical grid - essential for medical charts
            ctx.strokeStyle = color.replace('rgb(', 'rgba(').replace(')', ', 0.3)');
            ctx.lineWidth = 0.5;

            // Major grid lines every 50px
            for (let i = 0; i < width; i += 50) {
                ctx.beginPath();
                ctx.moveTo(i, 0);
                ctx.lineTo(i, height);
                ctx.stroke();
            }
            for (let i = 0; i < height; i += 25) {
                ctx.beginPath();
                ctx.moveTo(0, i);
                ctx.lineTo(width, i);
                ctx.stroke();
            }

            // Minor grid lines
            ctx.strokeStyle = color.replace('rgb(', 'rgba(').replace(')', ', 0.15)');
            ctx.lineWidth = 0.25;
            for (let i = 0; i < width; i += 10) {
                ctx.beginPath();
                ctx.moveTo(i, 0);
                ctx.lineTo(i, height);
                ctx.stroke();
            }
            for (let i = 0; i < height; i += 5) {
                ctx.beginPath();
                ctx.moveTo(0, i);
                ctx.lineTo(width, i);
                ctx.stroke();
            }

            // MEDICAL CHART: Always use scrolling window approach
            const now = Date.now();
            const windowStart = now - timeWindowMs;
            const windowEnd = now;

            // Show data within the scrolling window
            const visibleData = data.filter((point: TimestampedData) =>
                point.timestamp >= windowStart && point.timestamp <= windowEnd
            );

            // Draw title and baseline info
            ctx.fillStyle = color;
            ctx.font = 'bold 14px Arial';
            ctx.fillText(`${title}`, 10, 20);

            ctx.font = '11px Arial';
            ctx.fillStyle = '#888';
            ctx.fillText(`${visibleData.length} samples`, 10, height - 30);
            ctx.fillText(`${(timeWindowMs / 1000)}s window`, 10, height - 15);

            if (visibleData.length === 0) {
                // Show baseline even with no data
                ctx.strokeStyle = color.replace('rgb(', 'rgba(').replace(')', ', 0.5)');
                ctx.lineWidth = 1;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.moveTo(0, height / 2);
                ctx.lineTo(width, height / 2);
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.fillStyle = color;
                ctx.font = '12px Arial';
                ctx.fillText(`Waiting for ${title} signal...`, width / 2 - 80, height / 2 - 10);
                return;
            }

            // MEDICAL SCALING: Auto-scale or use provided min/max
            const values = visibleData.map(d => d.value);
            const minValue = min !== undefined ? min : Math.min(...values);
            const maxValue = max !== undefined ? max : Math.max(...values);
            const range = maxValue - minValue || 1;
            const padding = range * 0.1;

            // SCROLLING ANIMATION: Map time to horizontal position
            const pixelsPerMs = width / timeWindowMs;

            // Draw waveform line
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.shadowColor = color;
            ctx.shadowBlur = 2;
            ctx.beginPath();

            let firstPoint = true;
            visibleData.forEach((dataPoint: TimestampedData) => {
                // Calculate x position relative to current time (scrolling effect)
                const x = (dataPoint.timestamp - windowStart) * pixelsPerMs;

                // Calculate y position with proper scaling
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
            ctx.shadowBlur = 0;

            // Show current value
            if (visibleData.length > 0) {
                const currentValue = visibleData[visibleData.length - 1].value;
                ctx.fillStyle = color;
                ctx.font = 'bold 16px Arial';
                ctx.fillText(`${currentValue.toFixed(1)}`, width - 80, 25);

                ctx.font = '10px Arial';
                ctx.fillStyle = '#aaa';
                ctx.fillText(`Range: ${minValue.toFixed(0)} - ${maxValue.toFixed(0)}`, width - 120, height - 15);
            }
        };

        // Continuous animation for medical chart scrolling effect
        const animate = () => {
            render();
            animationFrameRef.current = requestAnimationFrame(animate);
        };

        animate();

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [data, color, title, timeWindowMs, width, height, min, max]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                width: `${width}px`,
                height: `${height}px`,
                border: '1px solid #333',
                borderRadius: '4px'
            }}
            className={className}
        />
    );
});

Chart.displayName = 'Chart';

export default Chart;