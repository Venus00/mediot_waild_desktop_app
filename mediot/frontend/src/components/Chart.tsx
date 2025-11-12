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
            return;
        }

        // Calculate time-based positioning with SMART TIMELINE MANAGEMENT
        // Use the latest data point as reference, but ensure proper data density
        const latestTimestamp = Math.max(...data.map(d => d.timestamp));
        const now = Date.now();
        const dataAge = (now - latestTimestamp) / 1000;

        let windowStart: number;
        let windowEnd: number;
        let visibleData: TimestampedData[];

        // Smart window positioning based on data freshness
        if (dataAge < 2 && data.length > 0) {
            // LIVE DATA: Use real-time 5-second scrolling window
            windowEnd = now;
            windowStart = now - timeWindowMs;
            visibleData = data.filter(point => point.timestamp >= windowStart && point.timestamp <= windowEnd);
        } else {
            // PAUSED DATA: Show ALL available data (no time window restriction)
            visibleData = data;

            // Set window bounds to encompass all data
            const allTimestamps = data.map(d => d.timestamp);
            const oldestData = Math.min(...allTimestamps);
            const newestData = Math.max(...allTimestamps);

            // Add small padding (2% on each side)
            const timeSpan = newestData - oldestData;
            const padding = Math.max(timeSpan * 0.02, 1000); // At least 1 second padding

            windowStart = oldestData - padding;
            windowEnd = newestData + padding;
        }

        // Calculate pixels per ms based on actual time span shown
        const actualTimeWindow = windowEnd - windowStart;
        const adjustedPixelsPerMs = canvas.width / actualTimeWindow;

        // Extract values for scaling from visible data only
        if (visibleData.length === 0) {
            // Show empty chart
            ctx.fillStyle = color;
            ctx.font = '12px Arial';
            ctx.fillText(`${title} - No Data`, 10, 15);
            return;
        }

        const values = visibleData.map(d => d.value);
        const minValue = Math.min(...values);
        const maxValue = Math.max(...values);
        const range = maxValue - minValue || 1;
        const padding = range * 0.1;

        // Draw the line chart - continuous line without gap detection
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        let firstPoint = true;

        visibleData.forEach((dataPoint) => {
            // Calculate x position using adjusted window (prevents data spreading)
            const x = (dataPoint.timestamp - windowStart) * adjustedPixelsPerMs;

            // Draw all visible points within the window
            const normalizedY = (dataPoint.value - minValue + padding) / (range + 2 * padding);
            const y = canvas.height - (normalizedY * canvas.height);

            if (firstPoint) {
                ctx.moveTo(x, y);
                firstPoint = false;
            } else {
                ctx.lineTo(x, y);
            }
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
        }

        ctx.fillStyle = color;
    }, [data, color, title, timeWindowMs]);

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
        // className={className}
        />
    );
};

export default Chart;