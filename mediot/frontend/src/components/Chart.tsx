import { useEffect, useRef } from 'react';

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
}

const Chart: React.FC<ChartProps> = ({
    data,
    color,
    title,
    width = 800,
    height = 150,
    className = "",
    timeWindowMs = 5000 // Default 5 second window
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // If no data, show empty chart
        if (data.length === 0) {
            ctx.fillStyle = color;
            ctx.font = '12px Arial';
            ctx.fillText(`${title} - No Data`, 10, 15);
            ctx.fillText(`Window: ${timeWindowMs / 1000}s`, 10, canvas.height - 10);
            return;
        }

        // Calculate time-based positioning with SMART TIMELINE MANAGEMENT
        // Use the latest data point as reference, but ensure proper data density
        const latestTimestamp = Math.max(...data.map(d => d.timestamp));
        const now = Date.now();
        const dataAge = (now - latestTimestamp) / 1000;

        let windowStart: number;
        let windowEnd: number;

        // Smart window positioning based on data freshness and density
        if (dataAge < 2 && data.length > 0) {
            // Live or recent data - use real-time window
            windowEnd = now;
            windowStart = now - timeWindowMs;
        } else {
            // Paused/old data - use data-based window to prevent spreading
            windowEnd = latestTimestamp;
            windowStart = latestTimestamp - timeWindowMs;
        }

        const pixelsPerMs = canvas.width / timeWindowMs; // Fixed scaling

        // Filter data to only show points within the time window
        const visibleData = data.filter(point => point.timestamp >= windowStart && point.timestamp <= windowEnd);

        // Check data density to prevent spreading
        if (visibleData.length > 0) {
            const dataTimeSpan = Math.max(...visibleData.map(d => d.timestamp)) - Math.min(...visibleData.map(d => d.timestamp));
            const expectedPoints = (dataTimeSpan / 4); // Expected at 250Hz (4ms intervals)
            const actualPoints = visibleData.length;
            const density = actualPoints / Math.max(expectedPoints, 1);

            // If data is too sparse (< 50% expected density), adjust window to maintain visual continuity
            if (density < 0.5 && dataAge > 1) {
                const adjustedTimeWindow = Math.min(dataTimeSpan * 1.2, timeWindowMs);
                windowStart = latestTimestamp - adjustedTimeWindow;
                windowEnd = latestTimestamp;
            }
        }

        // Recalculate pixelsPerMs after potential window adjustment
        const actualTimeWindow = windowEnd - windowStart;
        const adjustedPixelsPerMs = canvas.width / actualTimeWindow;

        // Extract values for scaling from visible data only
        if (visibleData.length === 0) {
            // Show empty chart with time labels
            ctx.fillStyle = color;
            ctx.font = '12px Arial';
            ctx.fillText(`${title} - No Data in Window`, 10, 15);
            ctx.fillText(`Window: ${timeWindowMs / 1000}s`, 10, canvas.height - 10);
            return;
        }

        const values = visibleData.map(d => d.value);
        const minValue = Math.min(...values);
        const maxValue = Math.max(...values);
        const range = maxValue - minValue || 1;
        const padding = range * 0.1;

        // Draw the line chart based on timestamps with gap detection
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        let firstPoint = true;
        let prevTimestamp = 0;

        visibleData.forEach((dataPoint) => {
            // Calculate x position using adjusted window (prevents data spreading)
            const x = (dataPoint.timestamp - windowStart) * adjustedPixelsPerMs;

            // Draw all visible points within the window
            const normalizedY = (dataPoint.value - minValue + padding) / (range + 2 * padding);
            const y = canvas.height - (normalizedY * canvas.height);

            // Check for time gap (more than 20ms between points)
            const timeDiff = dataPoint.timestamp - prevTimestamp;
            const shouldBreakLine = !firstPoint && timeDiff > 20;

            if (firstPoint || shouldBreakLine) {
                ctx.moveTo(x, y);
                firstPoint = false;
            } else {
                ctx.lineTo(x, y);
            }

            prevTimestamp = dataPoint.timestamp;
        });

        ctx.stroke();

        // Draw grid
        const gridColor = color.replace('rgb(', 'rgba(').replace(')', ', 0.2)');
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        for (let i = 0; i < canvas.width; i += 40) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, canvas.height);
            ctx.stroke();
        }
        for (let i = 0; i < canvas.height; i += 40) {
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(canvas.width, i);
            ctx.stroke();
        }

        // Draw value labels
        ctx.fillStyle = color;
        ctx.font = '12px Arial';
        ctx.fillText(`${title}`, 10, 15);
        ctx.fillText(`Min: ${minValue.toFixed(0)}`, 10, 30);
        ctx.fillText(`Max: ${maxValue.toFixed(0)}`, 10, 45);
        if (visibleData.length > 0) {
            ctx.fillText(`Current: ${visibleData[visibleData.length - 1].value.toFixed(0)}`, 10, 60);

            // Show data density info for debugging/monitoring
            const dataTimeSpan = Math.max(...visibleData.map(d => d.timestamp)) - Math.min(...visibleData.map(d => d.timestamp));
            const actualPoints = visibleData.length;
            const expectedPoints = Math.max(dataTimeSpan / 4, 1); // Expected at 250Hz
            const density = actualPoints / expectedPoints;

            if (density < 0.8 && actualPoints > 10) {
                ctx.fillStyle = '#ffaa00'; // Orange for low density warning
                ctx.fillText(`⚠ Low Data Density: ${(density * 100).toFixed(0)}%`, 10, 75);
                ctx.fillStyle = color;
            }
        }

        // Add time scale labels showing actual data timeline
        const timeWindowSeconds = timeWindowMs / 1000;

        // Draw data status indicator (reuse existing dataAge and now variables)
        if (dataAge < 1) {
            // Recent data - show as "live"
            ctx.fillStyle = '#00ff00'; // Green for live
            ctx.fillText('● LIVE', canvas.width - 50, canvas.height - 25);
            ctx.fillStyle = color;
            ctx.fillText('Live', canvas.width - 30, canvas.height - 10);
        } else if (dataAge < 10) {
            // Recent but not live - show age
            ctx.fillStyle = '#ffaa00'; // Orange for recent
            ctx.fillText('● PAUSED', canvas.width - 65, canvas.height - 25);
            ctx.fillStyle = color;
            ctx.fillText(`${dataAge.toFixed(0)}s ago`, canvas.width - 50, canvas.height - 10);
        } else {
            // Old data
            ctx.fillStyle = '#ff0000'; // Red for old
            ctx.fillText('● STALE', canvas.width - 55, canvas.height - 25);
            ctx.fillStyle = color;
            ctx.fillText(`${dataAge.toFixed(0)}s ago`, canvas.width - 50, canvas.height - 10);
        }

        ctx.fillStyle = color;
        ctx.fillText(`-${timeWindowSeconds}s`, 10, canvas.height - 10);
    }, [data, color, title, timeWindowMs]);

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className={className}
        />
    );
};

export default Chart;