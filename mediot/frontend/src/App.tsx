import { useState, useEffect, useRef } from "react";
import "./App.css";
import { GetSerialPorts, ConnectToSerialPort, DisconnectFromSerialPort, IsConnected, ReadSensorData } from "../wailsjs/go/main/App";
import { main } from "../wailsjs/go/models";

interface VitalSigns {
    heartRate: number;
    respirationRate: number;
    spo2: number;
    timestamp: Date;
}

function App() {
    const [vitals, setVitals] = useState<VitalSigns>({
        heartRate: 72,
        respirationRate: 16,
        spo2: 98,
        timestamp: new Date()
    });

    const [ecgData, setEcgData] = useState<number[]>([]);
    const [respirationData, setRespirationData] = useState<number[]>([]);
    const [spo2Data, setSpo2Data] = useState<number[]>([]);
    const [isMonitoring, setIsMonitoring] = useState(true);
    const [useRealData, setUseRealData] = useState(false);

    // Serial port state
    const [serialPorts, setSerialPorts] = useState<main.SerialPortInfo[]>([]);
    const [selectedPort, setSelectedPort] = useState<string>("");
    const [baudRate, setBaudRate] = useState<number>(9600);
    const [isConnected, setIsConnected] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<string>("");
    const [sensorData, setSensorData] = useState<main.SensorData | null>(null);

    const ecgCanvasRef = useRef<HTMLCanvasElement>(null);
    const respCanvasRef = useRef<HTMLCanvasElement>(null);
    const spo2CanvasRef = useRef<HTMLCanvasElement>(null);

    const maxDataPoints = 300;

    // Serial port functions
    const loadSerialPorts = async () => {
        try {
            const ports = await GetSerialPorts();
            setSerialPorts(ports);
            setConnectionStatus(`Found ${ports.length} serial ports`);
        } catch (error) {
            console.error('Error loading serial ports:', error);
            setConnectionStatus('Error loading serial ports');
        }
    };

    const connectToSerialPort = async () => {
        try {
            if (!selectedPort) return;

            const result = await ConnectToSerialPort(selectedPort, baudRate);
            if (result.success) {
                setIsConnected(true);
                setUseRealData(true);
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
            setUseRealData(false);
            setSensorData(null);
            setConnectionStatus(result.message);

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
                const data = await ReadSensorData();
                setSensorData(data);

                // Update vitals based on sensor data
                setVitals({
                    heartRate: data.value1,
                    respirationRate: data.value2,
                    spo2: data.value3,
                    timestamp: new Date()
                });

                // Update waveform data
                const now = Date.now();

                setEcgData(prev => {
                    const newData = [...prev, data.value1];
                    return newData.slice(-maxDataPoints);
                });

                setRespirationData(prev => {
                    const newData = [...prev, data.value2];
                    return newData.slice(-maxDataPoints);
                });

                setSpo2Data(prev => {
                    const newData = [...prev, data.value3];
                    return newData.slice(-maxDataPoints);
                });

            } catch (error) {
                console.error('Error reading sensor data:', error);
                // Don't update connection status here to avoid spam
            }
        }, 100); // Read every 100ms for smooth updates
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
                    setUseRealData(true);
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



    // Generate realistic ECG waveform (fallback when not using real data)
    const generateECGPoint = (time: number, heartRate: number): number => {
        const beatInterval = 60000 / heartRate; // ms per beat
        const beatPosition = (time % beatInterval) / beatInterval;

        // Simplified ECG waveform with P, QRS, T waves
        if (beatPosition < 0.1) {
            // P wave
            return 0.3 * Math.sin(beatPosition * 20 * Math.PI);
        } else if (beatPosition < 0.2) {
            // PR segment
            return 0;
        } else if (beatPosition < 0.3) {
            // QRS complex
            if (beatPosition < 0.25) {
                return -0.5 * Math.sin((beatPosition - 0.2) * 40 * Math.PI);
            } else {
                return 2.0 * Math.sin((beatPosition - 0.25) * 40 * Math.PI);
            }
        } else if (beatPosition < 0.5) {
            // ST segment
            return 0;
        } else if (beatPosition < 0.7) {
            // T wave
            return 0.5 * Math.sin((beatPosition - 0.5) * 10 * Math.PI);
        } else {
            // Baseline
            return 0;
        }
    };

    // Generate realistic respiration waveform (fallback when not using real data)
    const generateRespirationPoint = (time: number, respRate: number): number => {
        const breathInterval = 60000 / respRate; // ms per breath
        const breathPosition = (time % breathInterval) / breathInterval;
        return Math.sin(breathPosition * 2 * Math.PI);
    };

    // Update vital signs periodically (fallback when not using real data)
    useEffect(() => {
        if (!isMonitoring || useRealData) return;

        const vitalInterval = setInterval(() => {
            setVitals(prev => ({
                heartRate: prev.heartRate + (Math.random() - 0.5) * 4, // ±2 bpm variation
                respirationRate: Math.max(12, Math.min(20, prev.respirationRate + (Math.random() - 0.5) * 2)), // 12-20 rpm
                spo2: Math.max(95, Math.min(100, prev.spo2 + (Math.random() - 0.5) * 2)), // 95-100%
                timestamp: new Date()
            }));
        }, 5000); // Update every 5 seconds

        return () => clearInterval(vitalInterval);
    }, [isMonitoring, useRealData]);

    // Generate waveform data (fallback when not using real data)
    useEffect(() => {
        if (!isMonitoring || useRealData) return;

        const dataInterval = setInterval(() => {
            const now = Date.now();

            setEcgData(prev => {
                const newEcgPoint = generateECGPoint(now, vitals.heartRate);
                const newData = [...prev, newEcgPoint];
                return newData.slice(-maxDataPoints);
            });

            setRespirationData(prev => {
                const newRespPoint = generateRespirationPoint(now, vitals.respirationRate);
                const newData = [...prev, newRespPoint];
                return newData.slice(-maxDataPoints);
            });

            setSpo2Data(prev => {
                const newSpo2Point = vitals.spo2 + (Math.random() - 0.5) * 2;
                const newData = [...prev, newSpo2Point];
                return newData.slice(-maxDataPoints);
            });
        }, 50); // 20 fps for smooth waveforms

        return () => clearInterval(dataInterval);
    }, [isMonitoring, vitals.heartRate, vitals.respirationRate, vitals.spo2, useRealData]);

    // Draw Sensor Value 1 chart
    useEffect(() => {
        const canvas = ecgCanvasRef.current;
        if (!canvas || ecgData.length === 0) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Auto-scale based on data range
        const minValue = Math.min(...ecgData);
        const maxValue = Math.max(...ecgData);
        const range = maxValue - minValue || 1;
        const padding = range * 0.1;

        const stepX = canvas.width / Math.max(ecgData.length - 1, 1);

        // Draw the line chart
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.beginPath();

        ecgData.forEach((value, index) => {
            const x = index * stepX;
            const normalizedY = (value - minValue + padding) / (range + 2 * padding);
            const y = canvas.height - (normalizedY * canvas.height);

            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();

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
            ctx.fillText(`Current: ${ecgData[ecgData.length - 1].toFixed(0)}`, 10, 50);
        }
    }, [ecgData]);

    // Draw Sensor Value 2 chart
    useEffect(() => {
        const canvas = respCanvasRef.current;
        if (!canvas || respirationData.length === 0) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Auto-scale based on data range
        const minValue = Math.min(...respirationData);
        const maxValue = Math.max(...respirationData);
        const range = maxValue - minValue || 1;
        const padding = range * 0.1;

        const stepX = canvas.width / Math.max(respirationData.length - 1, 1);

        // Draw the line chart
        ctx.strokeStyle = '#00bfff';
        ctx.lineWidth = 2;
        ctx.beginPath();

        respirationData.forEach((value, index) => {
            const x = index * stepX;
            const normalizedY = (value - minValue + padding) / (range + 2 * padding);
            const y = canvas.height - (normalizedY * canvas.height);

            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();

        // Draw grid
        ctx.strokeStyle = 'rgba(0, 191, 255, 0.2)';
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
        ctx.fillStyle = '#00bfff';
        ctx.font = '12px Arial';
        ctx.fillText(`Min: ${minValue.toFixed(0)}`, 10, 20);
        ctx.fillText(`Max: ${maxValue.toFixed(0)}`, 10, 35);
        if (respirationData.length > 0) {
            ctx.fillText(`Current: ${respirationData[respirationData.length - 1].toFixed(0)}`, 10, 50);
        }
    }, [respirationData]);

    // Draw Sensor Value 3 chart
    useEffect(() => {
        const canvas = spo2CanvasRef.current;
        if (!canvas || spo2Data.length === 0) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Auto-scale based on data range
        const minValue = Math.min(...spo2Data);
        const maxValue = Math.max(...spo2Data);
        const range = maxValue - minValue || 1;
        const padding = range * 0.1;

        const stepX = canvas.width / Math.max(spo2Data.length - 1, 1);

        // Draw the line chart
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 2;
        ctx.beginPath();

        spo2Data.forEach((value, index) => {
            const x = index * stepX;
            const normalizedY = (value - minValue + padding) / (range + 2 * padding);
            const y = canvas.height - (normalizedY * canvas.height);

            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();

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
        if (spo2Data.length > 0) {
            ctx.fillText(`Current: ${spo2Data[spo2Data.length - 1].toFixed(0)}`, 10, 50);
        }
    }, [spo2Data]);

    return (
        <main className="monitoring-container">
            <header className="monitor-header">
                <h1>Patient Monitoring System</h1>
                <div className="status-indicator">
                    <span className={`status-dot ${isMonitoring ? 'active' : 'inactive'}`}></span>
                    <span>{isMonitoring ? 'MONITORING' : 'PAUSED'}</span>
                    <span className={`data-source ${useRealData ? 'real-data' : 'sim-data'}`}>
                        {useRealData ? 'REAL DATA' : 'SIMULATED'}
                    </span>
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
                        width={800}
                        height={200}
                    ></canvas>
                </div>

                <div className="waveform-panel">
                    <h3 className="waveform-title">Sensor Value 2</h3>
                    <canvas
                        ref={respCanvasRef}
                        className="waveform-canvas sensor2"
                        width={800}
                        height={200}
                    ></canvas>
                </div>

                <div className="waveform-panel">
                    <h3 className="waveform-title">Sensor Value 3</h3>
                    <canvas
                        ref={spo2CanvasRef}
                        className="waveform-canvas sensor3"
                        width={800}
                        height={200}
                    ></canvas>
                </div>
            </div>
        </main>
    );
}

export default App;
