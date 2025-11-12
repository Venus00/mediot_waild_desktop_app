import { useState, useEffect } from 'react';
import './App.css';
import { GetSerialPorts, ConnectToSerialPort, DisconnectFromSerialPort } from '../wailsjs/go/main/App';
import { main } from '../wailsjs/go/models';
import Chart from './components/Chart';
import UPlotChart from './components/UPlotChart';

interface TimestampedData {
    timestamp: number;
    value: number;
}

function App() {
    const [serialPorts, setSerialPorts] = useState<main.SerialPortInfo[]>([]);
    const [selectedPort, setSelectedPort] = useState<string>('');
    const [baudRate, setBaudRate] = useState<number>(115200);
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [connectionStatus, setConnectionStatus] = useState<string>('');
    const [isMonitoring, setIsMonitoring] = useState<boolean>(true);
    const [dataGapDetected, setDataGapDetected] = useState<boolean>(false);

    // Data arrays for three sensors
    const [ecgData, setEcgData] = useState<TimestampedData[]>([]);
    const [respData, setRespData] = useState<TimestampedData[]>([]);
    const [spo2Data, setSpo2Data] = useState<TimestampedData[]>([]);

    // Load available serial ports when component mounts
    useEffect(() => {
        loadSerialPorts();
    }, []);

    // Simulate receiving data from serial port
    useEffect(() => {
        if (!isConnected || !isMonitoring) return;

        const interval = setInterval(() => {
            const timestamp = Date.now();

            // Simulate three sensor values
            const ecgValue = 60 + Math.sin(timestamp / 100) * 20 + (Math.random() - 0.5) * 5;
            const respValue = 40 + Math.cos(timestamp / 500) * 15 + (Math.random() - 0.5) * 3;
            const spo2Value = 95 + Math.sin(timestamp / 300) * 3 + (Math.random() - 0.5) * 2;

            // Add new data points with TIMELINE-BASED MANAGEMENT
            // Keep data based on time window, not point count
            const timeWindow = 30000; // Keep 30 seconds of data (much larger buffer)
            const cutoffTime = timestamp - timeWindow;

            setEcgData(prev => {
                const newData = [...prev, { timestamp, value: ecgValue }];
                // Remove only data older than our time window
                return newData.filter(point => point.timestamp >= cutoffTime);
            });

            setRespData(prev => {
                const newData = [...prev, { timestamp, value: respValue }];
                return newData.filter(point => point.timestamp >= cutoffTime);
            });

            setSpo2Data(prev => {
                const newData = [...prev, { timestamp, value: spo2Value }];
                return newData.filter(point => point.timestamp >= cutoffTime);
            });
        }, 4); // 4ms interval for 250Hz sampling

        return () => clearInterval(interval);
    }, [isConnected, isMonitoring]);

    // Periodic cleanup of old data (runs every 30 seconds)
    useEffect(() => {
        const cleanup = setInterval(() => {
            const now = Date.now();
            const maxAge = 60000; // Keep maximum 60 seconds of data
            const cutoffTime = now - maxAge;

            setEcgData(prev => prev.filter(point => point.timestamp >= cutoffTime));
            setRespData(prev => prev.filter(point => point.timestamp >= cutoffTime));
            setSpo2Data(prev => prev.filter(point => point.timestamp >= cutoffTime));
        }, 30000); // Run every 30 seconds

        return () => clearInterval(cleanup);
    }, []);

    // Monitor for data gaps
    useEffect(() => {
        const checkDataGap = () => {
            const now = Date.now();
            const threshold = 100; // 100ms threshold for gap detection

            const ecgGap = ecgData.length > 0 && (now - ecgData[ecgData.length - 1].timestamp) > threshold;
            const respGap = respData.length > 0 && (now - respData[respData.length - 1].timestamp) > threshold;
            const spo2Gap = spo2Data.length > 0 && (now - spo2Data[spo2Data.length - 1].timestamp) > threshold;

            setDataGapDetected(ecgGap || respGap || spo2Gap);
        };

        const gapCheckInterval = setInterval(checkDataGap, 50);
        return () => clearInterval(gapCheckInterval);
    }, [ecgData, respData, spo2Data]);

    const loadSerialPorts = async () => {
        try {
            const ports = await GetSerialPorts();
            setSerialPorts(ports || []);
        } catch (error) {
            console.error('Failed to load serial ports:', error);
            setConnectionStatus('Failed to load serial ports');
        }
    };

    const connectToSerialPort = async () => {
        if (!selectedPort) return;

        try {
            setConnectionStatus('Connecting...');
            const result = await ConnectToSerialPort(selectedPort, baudRate);

            if (result.success) {
                setIsConnected(true);
                setConnectionStatus(result.message);
                // Clear previous data when connecting
                setEcgData([]);
                setRespData([]);
                setSpo2Data([]);
            } else {
                setConnectionStatus(result.message);
            }
        } catch (error) {
            console.error('Connection error:', error);
            setConnectionStatus('Connection error: ' + String(error));
        }
    };

    const disconnectFromSerialPort = async () => {
        try {
            const result = await DisconnectFromSerialPort();
            setIsConnected(false);
            setConnectionStatus(result.message);
        } catch (error) {
            console.error('Disconnect error:', error);
            setConnectionStatus('Disconnect error: ' + String(error));
        }
    };

    return (
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

            <div className="controls-section">
                <div className="serial-controls">
                    <div className="control-group">
                        <label htmlFor="port-select">Serial Port:</label>
                        <select
                            id="port-select"
                            value={selectedPort}
                            onChange={(e) => setSelectedPort(e.target.value)}
                            disabled={isConnected}
                        >
                            <option value="">Select a port...</option>
                            {serialPorts.map((port) => (
                                <option key={port.name} value={port.name}>
                                    {port.name} {port.description && `- ${port.description}`}
                                </option>
                            ))}
                        </select>
                        <button onClick={loadSerialPorts} disabled={isConnected}>
                            🔄 Refresh
                        </button>
                    </div>

                    <div className="control-group">
                        <label htmlFor="baud-rate">Baud Rate:</label>
                        <select
                            id="baud-rate"
                            value={baudRate}
                            onChange={(e) => setBaudRate(Number(e.target.value))}
                            disabled={isConnected}
                        >
                            <option value={9600}>9600</option>
                            <option value={19200}>19200</option>
                            <option value={38400}>38400</option>
                            <option value={57600}>57600</option>
                            <option value={115200}>115200</option>
                            <option value={230400}>230400</option>
                        </select>
                    </div>

                    <div className="connection-controls">
                        <button
                            onClick={connectToSerialPort}
                            disabled={isConnected || !selectedPort}
                            className="connect-btn"
                        >
                            Connect
                        </button>
                        <button
                            onClick={disconnectFromSerialPort}
                            disabled={!isConnected}
                            className="disconnect-btn"
                        >
                            Disconnect
                        </button>
                    </div>
                </div>

                {connectionStatus && (
                    <div className={`connection-status ${isConnected ? 'success' : 'error'}`}>
                        {connectionStatus}
                    </div>
                )}
            </div>

            <div className="waveform-container">
                <div className="waveform-panel">
                    <h4 style={{ margin: '0 0 10px 0', color: '#4ecdc4' }}>UPlot Chart (New) - High Performance</h4>
                    <UPlotChart
                        title="Sensor Value 2"
                        data={ecgData}
                        color="#4ecdc4"
                        width={980}
                        height={140}
                        className="waveform-canvas sensor1"
                        timeWindowMs={5000}
                    />
                </div>
                <div className="waveform-panel">
                    <h4 style={{ margin: '0 0 10px 0', color: '#4ecdc4' }}>UPlot Chart (New) - High Performance</h4>
                    <UPlotChart
                        title="Sensor Value 2"
                        data={respData}
                        color="#4ecdc4"
                        width={980}
                        height={140}
                        className="waveform-canvas sensor2"
                        timeWindowMs={5000}
                    />
                </div>

                <div className="waveform-panel">
                    <UPlotChart
                        title="Sensor Value 3"
                        data={spo2Data}
                        color="#45b7d1"
                        width={980}
                        height={140}
                        className="waveform-canvas sensor3"
                        timeWindowMs={5000}
                    />
                </div>
            </div>
        </main>
    );
}

export default App;