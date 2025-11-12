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

            // MEDICAL CHART: Clean chart with black background
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, width, height);

            // MEDICAL CHART: Always use left-to-right scrolling window approach            // MEDICAL CHART: Always use left-to-right scrolling window approach
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

            // OSCILLOSCOPE SWEEP: Calculate sweep position and cycle
            const sweepCycleMs = timeWindowMs; // Complete sweep every timeWindow
            const sweepPosition = (now % sweepCycleMs) / sweepCycleMs; // 0-1 position in sweep
            const sweepX = sweepPosition * width; // Current X position of sweep

            // Get data for current cycle AND previous cycle for smooth transition
            const cycleStart = now - (now % sweepCycleMs);
            const prevCycleStart = cycleStart - sweepCycleMs;

            // Current cycle data (being written)
            const currentCycleData = data.filter((point: TimestampedData) =>
                point.timestamp >= cycleStart && point.timestamp <= now
            );

            // Previous cycle data (old data to be overwritten)
            const prevCycleData = data.filter((point: TimestampedData) =>
                point.timestamp >= prevCycleStart && point.timestamp < cycleStart
            );

            // FIRST: Draw previous cycle data (old data) with reduced opacity
            if (prevCycleData.length > 0) {
                ctx.strokeStyle = color.replace('rgb(', 'rgba(').replace(')', ', 0.4)');
                ctx.lineWidth = 1.5;
                ctx.shadowColor = color;
                ctx.shadowBlur = 1;
                ctx.beginPath();

                let firstPoint = true;
                prevCycleData.forEach((dataPoint: TimestampedData) => {
                    // Map previous cycle data to current screen position
                    const timeInPrevCycle = dataPoint.timestamp - prevCycleStart;
                    const x = (timeInPrevCycle / sweepCycleMs) * width;

                    // Only draw old data that hasn't been overwritten yet
                    if (x > sweepX) {
                        const normalizedY = (dataPoint.value - minValue + padding) / (range + 2 * padding);
                        const y = height - (normalizedY * height);

                        if (firstPoint) {
                            ctx.moveTo(x, y);
                            firstPoint = false;
                        } else {
                            ctx.lineTo(x, y);
                        }
                    }
                });
                ctx.stroke();
            }

            // SECOND: Draw current cycle data (new data being written)
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.shadowColor = color;
            ctx.shadowBlur = 2;
            ctx.beginPath();

            let firstPoint = true;
            currentCycleData.forEach((dataPoint: TimestampedData) => {
                // SWEEP: Calculate x position within current sweep cycle
                const timeInCycle = dataPoint.timestamp - cycleStart;
                const x = (timeInCycle / sweepCycleMs) * width;

                // Calculate y position with proper scaling
                const normalizedY = (dataPoint.value - minValue + padding) / (range + 2 * padding);
                const y = height - (normalizedY * height);

                // Draw all points in current sweep cycle
                if (x >= 0 && x <= sweepX) { // Only draw up to sweep position
                    if (firstPoint) {
                        ctx.moveTo(x, y);
                        firstPoint = false;
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
            });

            ctx.stroke();
            ctx.shadowBlur = 0;

            // Clear zone after current writing position to avoid misconception
            const clearZoneWidth = 20; // 20 pixels clear zone
            ctx.fillStyle = '#000'; // Black background to clear old data
            if (sweepX + clearZoneWidth <= width) {
                ctx.fillRect(sweepX, 0, clearZoneWidth, height);
            } else {
                // Handle wrap-around clear zone
                ctx.fillRect(sweepX, 0, width - sweepX, height);
                ctx.fillRect(0, 0, clearZoneWidth - (width - sweepX), height);
            }

            // Show current value and sweep information
            if (currentCycleData.length > 0) {
                const currentValue = currentCycleData[currentCycleData.length - 1].value;
                ctx.fillStyle = color;
                ctx.font = 'bold 16px Arial';
                ctx.fillText(`${currentValue.toFixed(1)}`, width - 80, 25);

                ctx.font = '10px Arial';
                ctx.fillStyle = '#aaa';
                ctx.fillText(`Range: ${minValue.toFixed(0)} - ${maxValue.toFixed(0)}`, width - 120, height - 30);
                ctx.fillText(`Sweep: ${(sweepPosition * 100).toFixed(0)}%`, width - 120, height - 15);
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