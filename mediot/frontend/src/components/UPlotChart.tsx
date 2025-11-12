import { useEffect, useRef, useMemo } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

interface TimestampedData {
    timestamp: number;
    value: number;
}

interface UPlotChartProps {
    data: TimestampedData[];
    color: string;
    title: string;
    width?: number;
    height?: number;
    className?: string;
    timeWindowMs?: number;
}

const UPlotChart: React.FC<UPlotChartProps> = ({
    data,
    color,
    title,
    width = 980,
    height = 140,
    className = "",
    timeWindowMs = 5000
}) => {
    const chartRef = useRef<HTMLDivElement>(null);
    const uplotRef = useRef<uPlot | null>(null);

    const options = useMemo<uPlot.Options>(() => ({
        width,
        height,
        class: `uplot-chart ${className}`,

        // Time scale configuration for medical monitoring
        scales: {
            x: {
                time: true,
                auto: false, // Manual range control for fixed window
            },
            y: {
                auto: true, // Auto-scale Y based on visible data
            }
        },

        // Series configuration
        series: [
            {
                // X-axis (time)
                label: 'Time',
            },
            {
                // Y-axis (sensor values)
                label: title,
                stroke: color,
                fill: `${color}20`, // Semi-transparent fill
                width: 2,
                spanGaps: false, // Don't connect across data gaps
                show: true,
                points: {
                    show: false, // Hide individual points for smooth line
                }
            }
        ],

        // Axes configuration
        axes: [
            {
                // X-axis (time)
                scale: 'x',
                side: 1, // Bottom
                grid: {
                    show: true,
                    stroke: `${color}40`,
                    width: 1
                },
                ticks: {
                    show: true,
                    stroke: `${color}80`,
                    width: 1
                },
                font: '11px Arial',
                stroke: color,
                labelSize: 20,
            },
            {
                // Y-axis (values)
                scale: 'y',
                side: 3, // Left
                grid: {
                    show: true,
                    stroke: `${color}40`,
                    width: 1
                },
                ticks: {
                    show: true,
                    stroke: `${color}80`,
                    width: 1
                },
                font: '11px Arial',
                stroke: color,
                labelSize: 35,
            }
        ],

        // Cursor/crosshair configuration
        cursor: {
            show: true,
            x: true,
            y: true,
            lock: false,
        },

        // Legend configuration
        legend: {
            show: false, // Hide legend for medical monitoring look
        },

        // Padding [top, right, bottom, left]
        padding: [5, 5, 25, 45],
    }), [color, title, width, height, className]);

    useEffect(() => {
        if (!chartRef.current) return;

        // SMART TIME WINDOW MANAGEMENT for data continuity
        let windowStart: number;
        let windowEnd: number;

        if (data.length === 0) {
            if (uplotRef.current) {
                uplotRef.current.destroy();
                uplotRef.current = null;
            }

            // Show empty state
            chartRef.current.innerHTML = `
                <div style="
                    width: ${width}px; 
                    height: ${height}px; 
                    display: flex; 
                    flex-direction: column;
                    justify-content: center; 
                    align-items: center;
                    border: 1px solid ${color}40;
                    color: ${color};
                    font-family: Arial;
                    font-size: 14px;
                ">
                    <div>${title} - No Data</div>
                   
                </div>
            `;
            return;
        }

        // Determine window strategy based on data freshness
        const now = Date.now();
        const latestTimestamp = Math.max(...data.map(d => d.timestamp));
        const dataAge = (now - latestTimestamp) / 1000; // seconds

        let finalData: TimestampedData[];

        if (dataAge < 2) {
            // LIVE DATA: Use real-time scrolling 5-second window
            windowEnd = now;
            windowStart = now - timeWindowMs;
            finalData = data.filter(point =>
                point.timestamp >= windowStart && point.timestamp <= windowEnd
            );
        } else {
            // PAUSED DATA: Show ALL available data (no time window restriction)
            finalData = data;

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

        // Fallback if no data matches the criteria
        if (finalData.length === 0) {
            finalData = data.slice(-Math.ceil(timeWindowMs / 4)); // Show last N points as fallback

            if (finalData.length > 0) {
                const fallbackTimestamps = finalData.map(d => d.timestamp);
                windowStart = Math.min(...fallbackTimestamps);
                windowEnd = Math.max(...fallbackTimestamps);
            }
        } const timestamps = finalData.map(d => d.timestamp / 1000); // Convert to seconds
        const values = finalData.map(d => d.value);
        const chartData: uPlot.AlignedData = [timestamps, values];

        // Set time range based on the strategy used
        const timeRange = {
            min: windowStart / 1000,
            max: windowEnd / 1000
        };

        // Create or update chart
        if (!uplotRef.current) {
            // Create new chart
            const opts = {
                ...options,
                scales: {
                    ...options.scales,
                    x: {
                        ...options.scales?.x,
                        range: [timeRange.min, timeRange.max] as uPlot.Range.MinMax,
                    }
                }
            };
            uplotRef.current = new uPlot(opts, chartData, chartRef.current);
        } else {
            // Update existing chart
            uplotRef.current.setScale('x', timeRange);
            uplotRef.current.setData(chartData);
        }

    }, [data, options, timeWindowMs, width, height]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (uplotRef.current) {
                uplotRef.current.destroy();
            }
        };
    }, []);

    // Calculate status for display
    const status = useMemo(() => {
        if (data.length === 0) return null;

        const latestTimestamp = Math.max(...data.map(d => d.timestamp));
        const now = Date.now();
        const dataAge = (now - latestTimestamp) / 1000;
        const latestValue = data[data.length - 1]?.value;

        return {
            value: latestValue,
            age: dataAge,
            status: dataAge < 1 ? 'LIVE' : dataAge < 10 ? 'PAUSED' : 'STALE',
            color: dataAge < 1 ? '#00ff00' : dataAge < 10 ? '#ffaa00' : '#ff0000'
        };
    }, [data]);

    return (
        <div className={`uplot-container ${className}`} style={{ position: 'relative' }}>
            {/* Chart title */}
            <div style={{
                color,
                fontSize: '14px',
                fontWeight: 'bold',
                marginBottom: '2px',
                paddingLeft: '10px'
            }}>
                {title}
            </div>

            {/* Chart container */}
            <div ref={chartRef} />

            {/* Status overlay */}
            {status && (
                <div style={{
                    position: 'absolute',
                    top: '25px',
                    right: '10px',
                    fontSize: '11px',
                    background: 'rgba(0,0,0,0.7)',
                    padding: '4px 8px',
                    borderRadius: '3px',
                    color: 'white'
                }}>
                    <div style={{ color }}>
                        Current: {status.value.toFixed(0)}
                    </div>
                    <div style={{ color: status.color }}>
                        ● {status.status}
                    </div>
                </div>
            )}
        </div>
    );
};

export default UPlotChart;