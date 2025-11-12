import { useState, useEffect, useCallback, useMemo } from 'react';
import './App.css';
import { GetSerialPorts, ConnectToSerialPort, DisconnectFromSerialPort, ReadSensorData } from '../wailsjs/go/main/App';
import { main } from '../wailsjs/go/models';
import Chart from './components/Chart';

interface TimestampedData {
    timestamp: number;
    value: number;
}

// RASPBERRY PI: Circular buffer for memory efficiency
class CircularBuffer {
    private buffer: TimestampedData[];
    private head: number = 0;
    private size: number = 0;
    private readonly capacity: number;

    constructor(capacity: number = 1000) { // Max 1000 points for Raspberry Pi
        this.capacity = capacity;
        this.buffer = new Array(capacity);
    }

    push(data: TimestampedData): void {
        this.buffer[this.head] = data;
        this.head = (this.head + 1) % this.capacity;
        if (this.size < this.capacity) {
            this.size++;
        }
    }

    toArray(): TimestampedData[] {
        if (this.size === 0) return [];

        const result = new Array(this.size);
        let sourceIndex = this.size < this.capacity ? 0 : this.head;

        for (let i = 0; i < this.size; i++) {
            result[i] = this.buffer[sourceIndex];
            sourceIndex = (sourceIndex + 1) % this.capacity;
        }

        return result;
    }

    clear(): void {
        this.head = 0;
        this.size = 0;
    }

    length(): number {
        return this.size;
    }
}

function App() {
    const [serialPorts, setSerialPorts] = useState<main.SerialPortInfo[]>([]);
    const [selectedPort, setSelectedPort] = useState<string>('');
    const [baudRate, setBaudRate] = useState<number>(115200);
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [connectionStatus, setConnectionStatus] = useState<string>('');
    const [isMonitoring, setIsMonitoring] = useState<boolean>(true);
    const [isTestMode, setIsTestMode] = useState<boolean>(false);

    // RASPBERRY PI: Use circular buffers instead of growing arrays
    const [ecgBuffer] = useState(() => new CircularBuffer(1000));
    const [respBuffer] = useState(() => new CircularBuffer(1000));
    const [spo2Buffer] = useState(() => new CircularBuffer(1000));

    // State to trigger re-renders when buffers update
    const [bufferUpdateCount, setBufferUpdateCount] = useState(0);

    // Memory monitoring for Raspberry Pi
    const [memoryUsage, setMemoryUsage] = useState<{ heap: number, total: number } | null>(null);

    // Convert buffers to arrays for chart rendering (memoized)
    const ecgData = useMemo(() => ecgBuffer.toArray(), [bufferUpdateCount]);
    const respData = useMemo(() => respBuffer.toArray(), [bufferUpdateCount]);
    const spo2Data = useMemo(() => spo2Buffer.toArray(), [bufferUpdateCount]);

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

    // Simulate receiving data from serial port, generate test data, or generate zero data when idle
    useEffect(() => {
        if (!isMonitoring) {
            console.log(`Data generation stopped - Monitoring: ${isMonitoring}`);
            return;
        }

        // Always run the interval - determine behavior inside the interval
        console.log(`Starting data generation - Connected: ${isConnected}, TestMode: ${isTestMode}, Monitoring: ${isMonitoring}`);

        const interval = setInterval(async () => {
            const timestamp = Date.now();

            if (isTestMode && isConnected === false) {
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

                // RASPBERRY PI: Use circular buffers instead of growing arrays
                ecgBuffer.push(newDataPoint);
                respBuffer.push(newRespPoint);
                spo2Buffer.push(newSpo2Point);

                // Trigger re-render for charts
                setBufferUpdateCount(prev => prev + 1);

            } else if (isConnected) {
                // REAL MODE: Read actual serial port data
                try {
                    const sensorData = await ReadSensorData();

                    if (sensorData && sensorData.length > 0) {
                        // OPTIMIZED: Reduce debug logging frequency
                        if (timestamp % 500 < 10) {
                            console.log(`Read ${sensorData.length} sensor data points from serial port`);
                        }

                        // RASPBERRY PI: Add to circular buffers instead of arrays
                        sensorData.forEach(data => {
                            const dataTimestamp = new Date(data.timestamp).getTime();
                            ecgBuffer.push({ timestamp: dataTimestamp, value: data.value1 });
                            respBuffer.push({ timestamp: dataTimestamp, value: data.value2 });
                            spo2Buffer.push({ timestamp: dataTimestamp, value: data.value3 });
                        });

                        // Trigger re-render for charts
                        setBufferUpdateCount(prev => prev + 1);

                        // OPTIMIZED: Reduce debug logging frequency
                        if (timestamp % 500 < 10) {
                            console.log(`Real data - ECG: ${sensorData[sensorData.length - 1].value1.toFixed(1)}, Resp: ${sensorData[sensorData.length - 1].value2.toFixed(1)}, SpO2: ${sensorData[sensorData.length - 1].value3.toFixed(1)}`);
                        }
                    }
                } catch (error) {
                    console.error('Error reading sensor data:', error);
                }
            } else {
                // IDLE MODE: Generate zero data points to maintain chart animation
                // This keeps the oscilloscope active even when no real data is available
                const zeroEcg = { timestamp, value: 0 };
                const zeroResp = { timestamp, value: 0 };
                const zeroSpo2 = { timestamp, value: 0 };

                // OPTIMIZED: Reduce debug logging for zero data
                if (timestamp % 1000 < 10) {
                    console.log('Generating zero data points - no signal input');
                }

                // RASPBERRY PI: Add zero values to circular buffers
                ecgBuffer.push(zeroEcg);
                respBuffer.push(zeroResp);
                spo2Buffer.push(zeroSpo2);

                // Trigger re-render for charts
                setBufferUpdateCount(prev => prev + 1);
            }
        }, isTestMode ? 8 : (isConnected ? 200 : 100)); // RASPBERRY PI: Slower intervals - 8ms test (125Hz vs 250Hz), 200ms real data, 100ms zero data

        return () => {
            console.log('Stopping data generation interval');
            clearInterval(interval);
        };
    }, [isConnected, isMonitoring, isTestMode]);

    // RASPBERRY PI: Memory monitoring
    useEffect(() => {
        const memoryMonitor = setInterval(() => {
            if ((performance as any).memory) {
                const memory = (performance as any).memory;
                setMemoryUsage({
                    heap: Math.round(memory.usedJSHeapSize / 1024 / 1024),
                    total: Math.round(memory.totalJSHeapSize / 1024 / 1024)
                });

                // Aggressive cleanup if memory usage is high (> 50MB on Raspberry Pi)
                if (memory.usedJSHeapSize > 50 * 1024 * 1024) {
                    console.log('High memory usage detected, forcing cleanup');
                    ecgBuffer.clear();
                    respBuffer.clear();
                    spo2Buffer.clear();
                    setBufferUpdateCount(prev => prev + 1);
                }
            }
        }, 5000); // Check every 5 seconds

        return () => clearInterval(memoryMonitor);
    }, [ecgBuffer, respBuffer, spo2Buffer]);

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
                // RASPBERRY PI: Clear circular buffers instead of arrays
                ecgBuffer.clear();
                respBuffer.clear();
                spo2Buffer.clear();
                setBufferUpdateCount(prev => prev + 1);
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
        // RASPBERRY PI: Clear circular buffers for test mode
        ecgBuffer.clear();
        respBuffer.clear();
        spo2Buffer.clear();
        setBufferUpdateCount(prev => prev + 1);
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
                        {memoryUsage && (
                            ` | RAM: ${memoryUsage.heap}MB/${memoryUsage.total}MB`
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
                        timeWindowMs={10000}
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
                        timeWindowMs={10000}
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
                        timeWindowMs={10000}
                    />
                </div>
            </div>
        </main>
    );
}

export default App;