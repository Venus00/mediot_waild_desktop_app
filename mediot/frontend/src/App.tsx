import { useState, useEffect, useRef } from "react";
import "./App.css";
import { GetSerialPorts, ConnectToSerialPort, DisconnectFromSerialPort, IsConnected, ReadSensorData } from "../wailsjs/go/main/App";
import { main } from "../wailsjs/go/models";

interface TimestampedData {
    timestamp: number; // milliseconds
    value: number;
}

function App() {
    const [ecgData, setEcgData] = useState<TimestampedData[]>([]);
    const [respirationData, setRespirationData] = useState<TimestampedData[]>([]);
    const [spo2Data, setSpo2Data] = useState<TimestampedData[]>([]);
    const [isMonitoring, setIsMonitoring] = useState(true);
    const [lastDataTime, setLastDataTime] = useState<number>(0);
    const [dataGapDetected, setDataGapDetected] = useState(false);

    // Serial port state
    const [serialPorts, setSerialPorts] = useState<main.SerialPortInfo[]>([]);
    const [selectedPort, setSelectedPort] = useState<string>("");
    const [baudRate, setBaudRate] = useState<number>(115200);
    const [isConnected, setIsConnected] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<string>("");
    const [sensorData, setSensorData] = useState<main.SensorData | null>(null);

    const ecgCanvasRef = useRef<HTMLCanvasElement>(null);
    const respCanvasRef = useRef<HTMLCanvasElement>(null);
    const spo2CanvasRef = useRef<HTMLCanvasElement>(null);

    const maxDataPoints = 1000;

    // Serial port functions
    const loadSerialPorts = async () => {
        try {
            const ports = await GetSerialPorts();
            setSerialPorts(ports);
            setConnectionStatus(`Found ${ports.length} serial ports`);
        } catch (error) {
            console.error('Error loading serial ports:', error);
            setConnectionStatus('Error loadparing serial ports');
        }
    };

    const connectToSerialPort = async () => {
        try {
            if (!selectedPort) return;

            const result = await ConnectToSerialPort(selectedPort, baudRate);
            if (result.success) {
                setIsConnected(true);
                setConnectionStatus(result.message);

                // Start reading sensor data
                startSensorDataReading();
            } else {
                setConnectionStatus(result.message);
            }
        } catch (error) {
            console.error('Error connecting to serial port:', error);
            setConnectionStatus('Failed to connect to serial port');
        }
    };

    const disconnectFromSerialPort = async () => {
        try {
            const result = await DisconnectFromSerialPort();
            setIsConnected(false);
            setSensorData(null);
            setConnectionStatus(result.message);
            setDataGapDetected(false);
            setLastDataTime(0);

            // Stop reading sensor data
            stopSensorDataReading();
        } catch (error) {
            console.error('Error disconnecting from serial port:', error);
            setConnectionStatus('Error during disconnection');
        }
    };

    // Sensor data reading
    const sensorReadingInterval = useRef<number | null>(null);

    const startSensorDataReading = () => {
        if (sensorReadingInterval.current) {
            clearInterval(sensorReadingInterval.current);
        }

        sensorReadingInterval.current = setInterval(async () => {
            try {
                const dataArray = await ReadSensorData();

                if (dataArray.length > 0) {
                    // Reset gap detection when data is received
                    setDataGapDetected(false);

                    // Process each data point in the array
                    dataArray.forEach(data => {
                        setSensorData(data);

                        // Use the actual timestamp from the backend (convert to milliseconds)
                        const timestamp = new Date(data.timestamp).getTime();

                        // Check for data gaps (if more than 20ms between data points)
                        if (lastDataTime > 0 && (timestamp - lastDataTime) > 20) {
                            console.log(`Data gap detected: ${timestamp - lastDataTime}ms`);
                        }
                        setLastDataTime(timestamp);

                        // Update waveform data with real timestamps
                        setEcgData(prev => {
                            const newData = [...prev, { timestamp, value: data.value1 }];
                            return newData.slice(-maxDataPoints);
                        });

                        setRespirationData(prev => {
                            const newData = [...prev, { timestamp, value: data.value2 }];
                            return newData.slice(-maxDataPoints);
                        });

                        setSpo2Data(prev => {
                            const newData = [...prev, { timestamp, value: data.value3 }];
                            return newData.slice(-maxDataPoints);
                        });
                    });
                } else {
                    // No data received, check if we should mark a gap
                    const now = Date.now();
                    if (lastDataTime > 0 && (now - lastDataTime) > 100) {
                        setDataGapDetected(true);
                    }
                }

            } catch (error) {
                console.error('Error reading sensor data:', error);
                setDataGapDetected(true);
            }
        }, 100); // Read buffered data every 100ms
    };

    const stopSensorDataReading = () => {
        if (sensorReadingInterval.current) {
            clearInterval(sensorReadingInterval.current);
            sensorReadingInterval.current = null;
        }
    };

    // Check connection status on startup
    useEffect(() => {
        const checkConnection = async () => {
            try {
                const connected = await IsConnected();
                setIsConnected(connected);
                if (connected) {
                    startSensorDataReading();
                }
            } catch (error) {
                console.error('Error checking connection status:', error);
            }
        };

        checkConnection();
        loadSerialPorts(); // Load ports on startup

        return () => {
            stopSensorDataReading();
        };
    }, []);

    // Draw Sensor Value 1 chart
    useEffect(() => {
        const canvas = ecgCanvasRef.current;
        if (!canvas || ecgData.length === 0) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Extract values for scaling
        const values = ecgData.map(d => d.value);
        const minValue = Math.min(...values);
        const maxValue = Math.max(...values);
        const range = maxValue - minValue || 1;
        const padding = range * 0.1;

        // Calculate time-based positioning (left to right)
        if (ecgData.length === 0) return;

        // Use a fixed time window to always fill the canvas width
        const timeWindowMs = 4000; // 4 seconds visible window
        const timestamps = ecgData.map(d => d.timestamp);
        const maxTimestamp = Math.max(...timestamps);
        const minTimestamp = maxTimestamp - timeWindowMs; // Rolling window
        const pixelsPerMs = canvas.width / timeWindowMs;

        // Draw the line chart based on timestamps with gap detection
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.beginPath();

        let firstPoint = true;
        let prevTimestamp = 0;
        let prevX = -1;

        ecgData.forEach((dataPoint) => {
            // Calculate x position from left to right based on rolling window
            const x = (dataPoint.timestamp - minTimestamp) * pixelsPerMs;

            // Only draw points that are visible in the current window
            if (x >= 0 && x <= canvas.width) {
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
                prevX = x;
            }
        }); ctx.stroke();

        // Draw grid
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.2)';
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
        ctx.fillStyle = '#00ff00';
        ctx.font = '12px Arial';
        ctx.fillText(`Min: ${minValue.toFixed(0)}`, 10, 20);
        ctx.fillText(`Max: ${maxValue.toFixed(0)}`, 10, 35);
        if (ecgData.length > 0) {
            ctx.fillText(`Current: ${ecgData[ecgData.length - 1].value.toFixed(0)}`, 10, 50);
        }

        // Add time scale labels (left = oldest, right = newest)
        const timeRangeSeconds = timeWindowMs / 1000;
        ctx.fillText('Start', 10, canvas.height - 10);
        ctx.fillText(`+${timeRangeSeconds.toFixed(1)}s`, canvas.width - 60, canvas.height - 10);
    }, [ecgData]);    // Draw Sensor Value 2 chart
    useEffect(() => {
        const canvas = respCanvasRef.current;
        if (!canvas || respirationData.length === 0) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Extract values for scaling
        const values = respirationData.map(d => d.value);
        const minValue = Math.min(...values);
        const maxValue = Math.max(...values);
        const range = maxValue - minValue || 1;
        const padding = range * 0.1;

        // Calculate time-based positioning (left to right)
        if (respirationData.length === 0) return;

        // Use a fixed time window to always fill the canvas width
        const timeWindowMs = 4000; // 4 seconds visible window
        const timestamps = respirationData.map(d => d.timestamp);
        const maxTimestamp = Math.max(...timestamps);
        const minTimestamp = maxTimestamp - timeWindowMs; // Rolling window
        const pixelsPerMs = canvas.width / timeWindowMs;

        // Draw the line chart based on timestamps with gap detection
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 2;
        ctx.beginPath();

        let firstPoint = true;
        let prevTimestamp = 0;
        let prevX = -1;

        respirationData.forEach((dataPoint) => {
            // Calculate x position from left to right based on rolling window
            const x = (dataPoint.timestamp - minTimestamp) * pixelsPerMs;

            // Only draw points that are visible in the current window
            if (x >= 0 && x <= canvas.width) {
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
                prevX = x;
            }
        }); ctx.stroke();

        // Draw grid
        ctx.strokeStyle = 'rgba(255, 107, 107, 0.2)';
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
        ctx.fillStyle = '#ff6b6b';
        ctx.font = '12px Arial';
        ctx.fillText(`Min: ${minValue.toFixed(0)}`, 10, 20);
        ctx.fillText(`Max: ${maxValue.toFixed(0)}`, 10, 35);
        if (respirationData.length > 0) {
            ctx.fillText(`Current: ${respirationData[respirationData.length - 1].value.toFixed(0)}`, 10, 50);
        }

        // Add time scale labels (left = oldest, right = newest)
        const timeRangeSeconds = timeWindowMs / 1000;
        ctx.fillText('Start', 10, canvas.height - 10);
        ctx.fillText(`+${timeRangeSeconds.toFixed(1)}s`, canvas.width - 60, canvas.height - 10);
    }, [respirationData]);    // Draw Sensor Value 3 chart
    useEffect(() => {
        const canvas = spo2CanvasRef.current;
        if (!canvas || spo2Data.length === 0) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Extract values for scaling
        const values = spo2Data.map(d => d.value);
        const minValue = Math.min(...values);
        const maxValue = Math.max(...values);
        const range = maxValue - minValue || 1;
        const padding = range * 0.1;

        // Calculate time-based positioning (left to right)
        if (spo2Data.length === 0) return;

        // Use a fixed time window to always fill the canvas width
        const timeWindowMs = 4000; // 4 seconds visible window
        const timestamps = spo2Data.map(d => d.timestamp);
        const maxTimestamp = Math.max(...timestamps);
        const minTimestamp = maxTimestamp - timeWindowMs; // Rolling window
        const pixelsPerMs = canvas.width / timeWindowMs;

        // Draw the line chart based on timestamps with gap detection
        ctx.strokeStyle = '#4ecdc4';
        ctx.lineWidth = 2;
        ctx.beginPath();

        let firstPoint = true;
        let prevTimestamp = 0;
        let prevX = -1;

        spo2Data.forEach((dataPoint) => {
            // Calculate x position from left to right based on rolling window
            const x = (dataPoint.timestamp - minTimestamp) * pixelsPerMs;

            // Only draw points that are visible in the current window
            if (x >= 0 && x <= canvas.width) {
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
                prevX = x;
            }
        }); ctx.stroke();

        // Draw grid
        ctx.strokeStyle = 'rgba(78, 205, 196, 0.2)';
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
        ctx.fillStyle = '#4ecdc4';
        ctx.font = '12px Arial';
        ctx.fillText(`Min: ${minValue.toFixed(0)}`, 10, 20);
        ctx.fillText(`Max: ${maxValue.toFixed(0)}`, 10, 35);
        if (spo2Data.length > 0) {
            ctx.fillText(`Current: ${spo2Data[spo2Data.length - 1].value.toFixed(0)}`, 10, 50);
        }

        // Add time scale labels (left = oldest, right = newest)
        const timeRangeSeconds = timeWindowMs / 1000;
        ctx.fillText('Start', 10, canvas.height - 10);
        ctx.fillText(`+${timeRangeSeconds.toFixed(1)}s`, canvas.width - 60, canvas.height - 10);
    }, [spo2Data]); return (
        <main className="monitoring-container">
            <header className="monitor-header">
                <h1>Patient Monitoring System</h1>
                <div className="status-indicator">
                    <span className={`status-dot ${isMonitoring ? 'active' : 'inactive'}`}></span>
                    <span>{isMonitoring ? 'MONITORING' : 'PAUSED'}</span>
                    <span className={`data-source ${isConnected ? 'real-data' : 'disconnected'}`}>
                        {isConnected ? 'SERIAL DATA' : 'DISCONNECTED'}
                    </span>
                    {dataGapDetected && isConnected && (
                        <span className="data-gap-warning">
                            ⚠️ DATA GAP
                        </span>
                    )}
                    <button
                        className="toggle-btn"
                        onClick={() => setIsMonitoring(!isMonitoring)}
                    >
                        {isMonitoring ? 'Pause' : 'Resume'}
                    </button>
                </div>
            </header>

            {/* Serial Port Configuration */}
            <div className="serial-config-panel">
                <h3>Serial Port Configuration</h3>
                <div className="serial-controls">
                    <select
                        value={selectedPort}
                        onChange={(e) => setSelectedPort(e.target.value)}
                        disabled={isConnected}
                    >
                        <option value="">Select Port</option>
                        {serialPorts.map((port, index) => (
                            <option key={index} value={port.name}>
                                {port.name} {port.description ? `- ${port.description}` : ''}
                            </option>
                        ))}
                    </select>

                    <input
                        type="number"
                        value={baudRate}
                        onChange={(e) => setBaudRate(parseInt(e.target.value))}
                        placeholder="Baud Rate"
                        disabled={isConnected}
                        min="1200"
                        max="115200"
                    />

                    <button onClick={loadSerialPorts} disabled={isConnected}>
                        Refresh Ports
                    </button>

                    {!isConnected ? (
                        <button
                            className="connect-btn"
                            onClick={connectToSerialPort}
                            disabled={!selectedPort}
                        >
                            Connect
                        </button>
                    ) : (
                        <button
                            className="disconnect-btn"
                            onClick={disconnectFromSerialPort}
                        >
                            Disconnect
                        </button>
                    )}
                </div>

                {connectionStatus && (
                    <div className={`connection-status ${isConnected ? 'success' : 'error'}`}>
                        {connectionStatus}
                    </div>
                )}
            </div>

            <div className="waveform-container">
                <div className="waveform-panel">
                    <h3 className="waveform-title">Sensor Value 1</h3>
                    <canvas
                        ref={ecgCanvasRef}
                        className="waveform-canvas sensor1"
                        width={980}
                        height={140}
                    ></canvas>
                </div>

                <div className="waveform-panel">
                    <h3 className="waveform-title">Sensor Value 2</h3>
                    <canvas
                        ref={respCanvasRef}
                        className="waveform-canvas sensor2"
                        width={980}
                        height={140}
                    ></canvas>
                </div>

                <div className="waveform-panel">
                    <h3 className="waveform-title">Sensor Value 3</h3>
                    <canvas
                        ref={spo2CanvasRef}
                        className="waveform-canvas sensor3"
                        width={980}
                        height={140}
                    ></canvas>
                </div>
            </div>
        </main>
    );
}

export default App;
