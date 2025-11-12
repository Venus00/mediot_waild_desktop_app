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

            // MEDICAL CHART: Medical monitor background with grid
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, width, height);

            // MEDICAL GRID: Draw medical-style grid
            ctx.strokeStyle = 'rgba(0, 255, 65, 0.1)';
            ctx.lineWidth = 0.5;

            // Major grid lines (every 50 pixels)
            const majorGridX = 50;
            const majorGridY = 25;

            for (let x = 0; x <= width; x += majorGridX) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
            }

            for (let y = 0; y <= height; y += majorGridY) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
            }

            // Minor grid lines
            ctx.strokeStyle = 'rgba(0, 255, 65, 0.05)';
            const minorGridX = majorGridX / 5;
            const minorGridY = majorGridY / 5;

            for (let x = 0; x <= width; x += minorGridX) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
            }

            for (let y = 0; y <= height; y += minorGridY) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
            }

            // MEDICAL CHART: Time window filtering
            const now = Date.now();
            const windowStart = now - timeWindowMs;
            const windowEnd = now;

            // Filter data to current time window
            const visibleData = data.filter((point: TimestampedData) =>
                point.timestamp >= windowStart && point.timestamp <= windowEnd
            );

            // MEDICAL SCALING: Calculate value range
            let minValue: number, maxValue: number, range: number, padding: number;

            if (visibleData.length === 0) {
                // MEDICAL BASELINE: Show flat line at 0 when no data
                const baselineData: TimestampedData[] = [];
                const numPoints = Math.floor(width / 5);

                for (let i = 0; i < numPoints; i++) {
                    const timestamp = windowStart + (i / (numPoints - 1)) * timeWindowMs;
                    baselineData.push({ timestamp, value: 0 });
                }

                // Use baseline for display
                const baseMinValue = min !== undefined ? min : -10;
                const baseMaxValue = max !== undefined ? max : 10;
                const baseRange = baseMaxValue - baseMinValue || 1;
                const basePadding = baseRange * 0.1;

                // Draw baseline
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                ctx.globalAlpha = 0.3;
                ctx.beginPath();

                let firstPoint = true;
                baselineData.forEach((dataPoint: TimestampedData) => {
                    const timeProgress = (dataPoint.timestamp - windowStart) / timeWindowMs;
                    const x = timeProgress * width;
                    const normalizedY = (0 - baseMinValue + basePadding) / (baseRange + 2 * basePadding);
                    const y = height - (normalizedY * height);

                    if (firstPoint) {
                        ctx.moveTo(x, y);
                        firstPoint = false;
                    } else {
                        ctx.lineTo(x, y);
                    }
                });

                ctx.stroke();
                ctx.globalAlpha = 1.0;

                // Status text
                ctx.fillStyle = color;
                ctx.font = '10px Arial';
                ctx.fillText('NO SIGNAL', width - 80, 20);
                return;
            }

            const values = visibleData.map(d => d.value);
            minValue = min !== undefined ? min : Math.min(...values);
            maxValue = max !== undefined ? max : Math.max(...values);
            range = maxValue - minValue || 1;
            padding = range * 0.1;

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