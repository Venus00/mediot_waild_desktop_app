import { useState, useEffect, useCallback, useMemo } from 'react';
import './App.css';
import { GetSerialPorts, ConnectToSerialPort, DisconnectFromSerialPort, ReadSensorData } from '../wailsjs/go/main/App';
import { main } from '../wailsjs/go/models';
import Chart from './components/Chart';

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
    const [isTestMode, setIsTestMode] = useState<boolean>(false);

    // Data arrays for three sensors
    const [ecgData, setEcgData] = useState<TimestampedData[]>([]);
    const [respData, setRespData] = useState<TimestampedData[]>([]);
    const [spo2Data, setSpo2Data] = useState<TimestampedData[]>([]);

    // OPTIMIZED: Memoized data statistics to prevent recalculation on every render
    const dataStats = useMemo(() => ({
        ecgPoints: ecgData.length,
        respPoints: respData.length,
        spo2Points: spo2Data.length,
        totalPoints: ecgData.length + respData.length + spo2Data.length,
        dataRate: ecgData.length > 1 ? (ecgData.length / ((ecgData[ecgData.length - 1]?.timestamp - ecgData[0]?.timestamp) / 1000) || 0) : 0
    }), [ecgData.length, respData.length, spo2Data.length, ecgData]);

    // Load available serial ports when component mounts
    useEffect(() => {
        loadSerialPorts();
    }, []);

    // Simulate receiving data from serial port OR generate test data
    useEffect(() => {
        if ((!isConnected && !isTestMode) || !isMonitoring) {
            console.log(`Data generation stopped - Connected: ${isConnected}, TestMode: ${isTestMode}, Monitoring: ${isMonitoring}`);
            return;
        }

        console.log(`Starting data generation - TestMode: ${isTestMode}`);

        const interval = setInterval(async () => {
            const timestamp = Date.now();

            if (isTestMode) {
                // TEST MODE: Generate realistic medical waveforms
                let ecgValue: number, respValue: number, spo2Value: number;

                // ECG: Simulate realistic heartbeat pattern (~75 BPM)
                const heartRate = 75; // BPM
                const beatInterval = 60000 / heartRate; // ms per beat
                const beatPhase = (timestamp % beatInterval) / beatInterval; // 0-1 phase within beat

                let ecg = 0;
                if (beatPhase < 0.1) {
                    // P wave (atrial depolarization)
                    ecg = 2 * Math.sin(beatPhase * 10 * Math.PI);
                } else if (beatPhase < 0.15) {
                    // PR interval (flat)
                    ecg = 0;
                } else if (beatPhase < 0.25) {
                    // QRS complex (ventricular depolarization)
                    const qrsPhase = (beatPhase - 0.15) / 0.1;
                    if (qrsPhase < 0.3) {
                        ecg = -5 * Math.sin(qrsPhase * 3.33 * Math.PI); // Q wave
                    } else if (qrsPhase < 0.7) {
                        ecg = 20 * Math.sin((qrsPhase - 0.3) * 2.5 * Math.PI); // R wave
                    } else {
                        ecg = -8 * Math.sin((qrsPhase - 0.7) * 3.33 * Math.PI); // S wave
                    }
                } else if (beatPhase < 0.4) {
                    // ST segment (flat)
                    ecg = 0;
                } else if (beatPhase < 0.6) {
                    // T wave (ventricular repolarization)
                    ecg = 4 * Math.sin((beatPhase - 0.4) * 5 * Math.PI);
                } else {
                    // Baseline
                    ecg = 0;
                }
                ecgValue = ecg + (Math.random() - 0.5) * 1.5; // Add realistic noise

                // Respiratory: Realistic breathing pattern (~16 breaths/min)
                const breathRate = 16; // breaths per minute
                const breathCycle = 60000 / breathRate; // ms per breath
                const breathPhase = (timestamp % breathCycle) / breathCycle; // 0-1 phase

                // Inspiration (40%) and expiration (60%) with realistic curve
                let respiration;
                if (breathPhase < 0.4) {
                    // Inspiration - steeper rise
                    respiration = 25 * Math.sin(breathPhase * 2.5 * Math.PI);
                } else {
                    // Expiration - gentler fall
                    respiration = 25 * Math.sin(breathPhase * Math.PI) * 0.6;
                }
                respValue = respiration + (Math.random() - 0.5) * 2;

                // SpO2: Realistic pulse oximetry with heartbeat modulation
                const spo2Baseline = 98; // Normal oxygen saturation
                const pulseModulation = 2 * Math.sin(beatPhase * 2 * Math.PI); // Pulse wave
                spo2Value = spo2Baseline + pulseModulation + (Math.random() - 0.5) * 0.8;

                // OPTIMIZED: Reduce debug logging frequency (every 100 iterations)
                if (timestamp % 400 < 10) {
                    console.log(`Test mode data - ECG: ${ecgValue.toFixed(1)}, Resp: ${respValue.toFixed(1)}, SpO2: ${spo2Value.toFixed(1)}`);
                }

                // OPTIMIZED: Batch all data updates to reduce re-renders
                const newDataPoint = { timestamp, value: ecgValue };
                const newRespPoint = { timestamp, value: respValue };
                const newSpo2Point = { timestamp, value: spo2Value };

                // Use functional updates with batching (React 18 automatic batching)
                setEcgData(prev => [...prev, newDataPoint]);
                setRespData(prev => [...prev, newRespPoint]);
                setSpo2Data(prev => [...prev, newSpo2Point]);

            } else if (isConnected) {
                // REAL MODE: Read actual serial port data
                try {
                    const sensorData = await ReadSensorData();

                    if (sensorData && sensorData.length > 0) {
                        // OPTIMIZED: Reduce debug logging frequency
                        if (timestamp % 500 < 10) {
                            console.log(`Read ${sensorData.length} sensor data points from serial port`);
                        }

                        // OPTIMIZED: Batch process all sensor data points
                        const ecgPoints: TimestampedData[] = [];
                        const respPoints: TimestampedData[] = [];
                        const spo2Points: TimestampedData[] = [];

                        sensorData.forEach(data => {
                            const dataTimestamp = new Date(data.timestamp).getTime();
                            ecgPoints.push({ timestamp: dataTimestamp, value: data.value1 });
                            respPoints.push({ timestamp: dataTimestamp, value: data.value2 });
                            spo2Points.push({ timestamp: dataTimestamp, value: data.value3 });
                        });

                        // Batch update all arrays at once (reduces re-renders from N*3 to 3)
                        setEcgData(prev => [...prev, ...ecgPoints]);
                        setRespData(prev => [...prev, ...respPoints]);
                        setSpo2Data(prev => [...prev, ...spo2Points]);

                        // OPTIMIZED: Reduce debug logging frequency
                        if (timestamp % 500 < 10) {
                            console.log(`Real data - ECG: ${sensorData[sensorData.length - 1].value1.toFixed(1)}, Resp: ${sensorData[sensorData.length - 1].value2.toFixed(1)}, SpO2: ${sensorData[sensorData.length - 1].value3.toFixed(1)}`);
                        }
                    }
                } catch (error) {
                    console.error('Error reading sensor data:', error);
                }
            }
        }, isTestMode ? 4 : 100); // 4ms for test mode (250Hz), 50ms for real data reading

        return () => {
            console.log('Stopping data generation interval');
            clearInterval(interval);
        };
    }, [isConnected, isMonitoring, isTestMode]);

    // OPTIMIZED: Memoized cleanup function to prevent unnecessary re-creations
    const cleanupData = useCallback((dataArray: TimestampedData[], cutoffTime: number, minPoints: number = 100): TimestampedData[] => {
        const filtered = dataArray.filter(point => point.timestamp >= cutoffTime);
        return filtered.length >= minPoints ? filtered : dataArray.slice(-minPoints);
    }, []);

    // Intelligent cleanup of old data - preserves data continuity during interruptions
    useEffect(() => {
        const cleanup = setInterval(() => {
            const now = Date.now();

            // More intelligent cleanup: Only clean up if we're actively receiving data
            // This preserves historical data during interruptions
            const shouldCleanup = isMonitoring && (isConnected || isTestMode);

            if (shouldCleanup) {
                const maxAge = 300000; // Keep 5 minutes of data when actively monitoring
                const cutoffTime = now - maxAge;

                // OPTIMIZED: Batch cleanup operations
                setEcgData(prev => cleanupData(prev, cutoffTime));
                setRespData(prev => cleanupData(prev, cutoffTime));
                setSpo2Data(prev => cleanupData(prev, cutoffTime));

                console.log('Data cleanup performed - preserving historical data for continuity');
            } else {
                console.log('Skipping data cleanup - preserving data during interruption');
            }
        }, 60000); // Run every 1 minute (less aggressive)

        return () => clearInterval(cleanup);
    }, [isMonitoring, isConnected, isTestMode, cleanupData]); const loadSerialPorts = async () => {
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

    const startTestMode = () => {
        setIsTestMode(true);
        setConnectionStatus('Test mode active - generating random data');
        // Clear previous data when starting test mode
        setEcgData([]);
        setRespData([]);
        setSpo2Data([]);
    };

    const stopTestMode = () => {
        setIsTestMode(false);
        setConnectionStatus('Test mode stopped');
    };

    return (
        <main className="monitoring-container">
            <header className="monitor-header">
                <h1>Patient Monitoring System</h1>
                <div className="status-indicator">
                    <span className={`status-dot ${isMonitoring ? 'active' : 'inactive'}`}></span>
                    <span>{isMonitoring ? 'MONITORING' : 'PAUSED'}</span>
                    <span className={`data-source ${isConnected ? 'real-data' : isTestMode ? 'test-data' : 'disconnected'}`}>
                        {isConnected ? 'SERIAL DATA' : isTestMode ? 'TEST DATA' : 'DISCONNECTED'}
                    </span>

                    {/* OPTIMIZED: Performance indicator */}
                    <span className="performance-stats" style={{
                        fontSize: '11px',
                        color: '#888',
                        fontFamily: 'monospace'
                    }}>
                        {dataStats.totalPoints > 0 && (
                            `${dataStats.totalPoints} pts | ${dataStats.dataRate.toFixed(0)} Hz`
                        )}
                    </span>

                    <button
                        className="toggle-btn"
                        onClick={() => setIsMonitoring(!isMonitoring)}
                    >
                        {isMonitoring ? 'Pause' : 'Resume'}
                    </button>
                </div>
            </header>

            <div className="controls-section">
                {/* Test Mode Controls */}
                <div className="test-controls" style={{
                    marginBottom: '20px',
                    padding: '15px',
                    border: '2px solid #4ecdc4',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(78, 205, 196, 0.1)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <button
                            onClick={startTestMode}
                            disabled={isTestMode || isConnected}
                            className="connect-btn"
                            style={{
                                backgroundColor: isTestMode ? '#6c7b7f' : '#4ecdc4',
                                minWidth: '120px'
                            }}
                        >
                            {isTestMode ? 'Test Active' : 'Start Test Mode'}
                        </button>
                        <button
                            onClick={stopTestMode}
                            disabled={!isTestMode}
                            className="disconnect-btn"
                            style={{ minWidth: '120px' }}
                        >
                            Stop Test Mode
                        </button>
                        <span style={{
                            color: '#4ecdc4',
                            fontSize: '14px',
                            fontStyle: 'italic'
                        }}>
                        </span>
                    </div>
                </div>

                <div className="serial-controls">
                    <div className="control-group">
                        <label htmlFor="port-select">Serial Port:</label>
                        <select
                            id="port-select"
                            value={selectedPort}
                            onChange={(e) => setSelectedPort(e.target.value)}
                            disabled={isConnected || isTestMode}
                        >
                            <option value="">Select a port...</option>
                            {serialPorts.map((port) => (
                                <option key={port.name} value={port.name}>
                                    {port.name} {port.description && `- ${port.description}`}
                                </option>
                            ))}
                        </select>
                        <button onClick={loadSerialPorts} disabled={isConnected || isTestMode}>
                            🔄 Refresh
                        </button>
                    </div>

                    <div className="control-group">
                        <label htmlFor="baud-rate">Baud Rate:</label>
                        <select
                            id="baud-rate"
                            value={baudRate}
                            onChange={(e) => setBaudRate(Number(e.target.value))}
                            disabled={isConnected || isTestMode}
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
                            disabled={isConnected || !selectedPort || isTestMode}
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
                    <Chart
                        title="ECG"
                        data={ecgData}
                        color="#00ff00"
                        width={980}
                        height={140}
                        className="waveform-canvas-sensor1"
                        timeWindowMs={5000}
                        min={-300}
                        max={300}
                    />
                </div>
                <div className="waveform-panel">
                    <Chart
                        title="Respiratory"
                        data={respData}
                        color="#ff0000"
                        width={980}
                        height={140}
                        className="waveform-canvas-sensor2"
                        timeWindowMs={5000}
                        min={-50}
                        max={50}
                    />
                </div>

                <div className="waveform-panel">
                    <Chart
                        title="SpO2"
                        data={spo2Data}
                        color="#0000ff"
                        width={980}
                        height={140}
                        className="waveform-canvas-sensor3"
                        timeWindowMs={5000}
                        min={95}
                        max={100}
                    />
                </div>
            </div>
        </main>
    );
}

export default App;