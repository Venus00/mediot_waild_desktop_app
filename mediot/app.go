package main

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.bug.st/serial"
)

// App struct
type App struct {
	ctx              context.Context
	serialPort       serial.Port
	isConnected      bool
	dataBuffer       []byte       // Buffer to accumulate incoming data
	parsedDataBuffer []SensorData // Buffer to store parsed sensor data
	bufferMutex      sync.RWMutex // Mutex to protect the buffer
}

// SerialPortInfo represents information about a serial port
type SerialPortInfo struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// ConnectionResult represents the result of a connection attempt
type ConnectionResult struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// SensorData represents the data received from the sensor
type SensorData struct {
	Value1    float64   `json:"value1"`
	Value2    float64   `json:"value2"`
	Value3    float64   `json:"value3"`
	Timestamp time.Time `json:"timestamp"`
}

// NewApp creates a new App application struct
func NewApp() *App {
	app := &App{
		isConnected:      false,
		dataBuffer:       make([]byte, 0),
		parsedDataBuffer: make([]SensorData, 0),
	}

	// Start background serial reader
	go app.serialReader()

	return app
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// GetSerialPorts returns a list of available serial ports
func (a *App) GetSerialPorts() ([]SerialPortInfo, error) {
	ports, err := serial.GetPortsList()
	if err != nil {
		log.Printf("Error getting serial ports: %v", err)
		return nil, err
	}

	var result []SerialPortInfo
	for _, port := range ports {
		result = append(result, SerialPortInfo{
			Name:        port,
			Description: "Serial Port",
		})
	}

	log.Printf("Found %d serial ports", len(result))
	return result, nil
}

// ConnectToSerialPort attempts to connect to the specified serial port
func (a *App) ConnectToSerialPort(portName string, baudRate int) ConnectionResult {
	if a.isConnected {
		return ConnectionResult{
			Success: false,
			Message: "Already connected to a port",
		}
	}

	mode := &serial.Mode{
		BaudRate: baudRate,
		Parity:   serial.NoParity,
		DataBits: 8,
		StopBits: serial.OneStopBit,
	}

	port, err := serial.Open(portName, mode)
	if err != nil {
		log.Printf("Error opening serial port %s: %v", portName, err)
		return ConnectionResult{
			Success: false,
			Message: fmt.Sprintf("Failed to open port: %v", err),
		}
	}

	a.serialPort = port
	a.isConnected = true
	a.dataBuffer = make([]byte, 0) // Clear buffer on new connection

	log.Printf("Successfully connected to %s at %d baud", portName, baudRate)
	return ConnectionResult{
		Success: true,
		Message: fmt.Sprintf("Connected to %s at %d baud", portName, baudRate),
	}
}

// serialReader runs in background to continuously read and buffer serial data
func (a *App) serialReader() {
	for {
		if !a.isConnected || a.serialPort == nil {
			time.Sleep(100 * time.Millisecond)
			continue
		}

		// Set read timeout
		a.serialPort.SetReadTimeout(10 * time.Millisecond)

		// Read available data from serial port
		tempBuffer := make([]byte, 100)
		n, err := a.serialPort.Read(tempBuffer)
		if err != nil {
			if !strings.Contains(err.Error(), "timeout") {
				log.Printf("Error reading from serial port: %v", err)
			}
			continue
		}

		if n == 0 {
			continue
		}

		// Add new data to buffer
		a.bufferMutex.Lock()
		a.dataBuffer = append(a.dataBuffer, tempBuffer[:n]...)

		// Process complete lines
		dataStr := string(a.dataBuffer)
		lines := strings.Split(dataStr, "\n")

		// Process all complete lines except the last one (which might be incomplete)
		for i := 0; i < len(lines)-1; i++ {
			line := strings.TrimSpace(lines[i])
			if line != "" {
				sensorData, err := a.parseHexData(line)
				if err == nil {
					// Add to parsed data buffer
					a.parsedDataBuffer = append(a.parsedDataBuffer, *sensorData)
				} else {
					log.Printf("Error parsing line '%s': %v", line, err)
				}
			}
		}

		// Keep only the last incomplete line in buffer
		if len(lines) > 0 {
			lastLine := lines[len(lines)-1]
			a.dataBuffer = []byte(lastLine)
		}

		// Clear buffer if it gets too large
		if len(a.dataBuffer) > 500 {
			a.dataBuffer = a.dataBuffer[:0]
		}

		a.bufferMutex.Unlock()
	}
}

// DisconnectFromSerialPort disconnects from the current serial port
func (a *App) DisconnectFromSerialPort() ConnectionResult {
	if !a.isConnected || a.serialPort == nil {
		return ConnectionResult{
			Success: false,
			Message: "No active connection",
		}
	}

	err := a.serialPort.Close()
	if err != nil {
		log.Printf("Error closing serial port: %v", err)
		return ConnectionResult{
			Success: false,
			Message: fmt.Sprintf("Error closing port: %v", err),
		}
	}

	a.serialPort = nil
	a.isConnected = false
	a.dataBuffer = make([]byte, 0) // Clear buffer on disconnect

	log.Println("Serial port disconnected")
	return ConnectionResult{
		Success: true,
		Message: "Disconnected successfully",
	}
}

// IsConnected returns the current connection status
func (a *App) IsConnected() bool {
	return a.isConnected
}

// ReadSensorData returns all buffered sensor data and clears the buffer
func (a *App) ReadSensorData() ([]SensorData, error) {
	if !a.isConnected {
		return nil, fmt.Errorf("not connected to serial port")
	}

	a.bufferMutex.Lock()
	defer a.bufferMutex.Unlock()

	// Return all buffered data
	result := make([]SensorData, len(a.parsedDataBuffer))
	copy(result, a.parsedDataBuffer)

	// Clear the buffer after returning data
	a.parsedDataBuffer = a.parsedDataBuffer[:0]

	log.Printf("Returning %d sensor data points", len(result))
	return result, nil
}

// parseHexData parses comma-separated hex values (e.g., "0x215c,0x3711,0xffffa4d9")
func (a *App) parseHexData(dataStr string) (*SensorData, error) {
	// Clean the data string
	dataStr = strings.TrimSpace(dataStr)

	// Expected format: "0xvalue1,0xvalue2,0xvalue3"
	parts := strings.Split(dataStr, ",")
	if len(parts) < 3 {
		return nil, fmt.Errorf("invalid format: expected 3 hex values, got %d in '%s'", len(parts), dataStr)
	}

	// Check if all parts are valid hex format
	for i, part := range parts[:3] {
		part = strings.TrimSpace(part)
		if !strings.HasPrefix(part, "0x") && !strings.HasPrefix(part, "0X") {
			return nil, fmt.Errorf("part %d '%s' is not valid hex format", i+1, part)
		}
		// Check if hex part has enough characters
		hexPart := part[2:]
		if len(hexPart) == 0 || len(hexPart) > 8 {
			return nil, fmt.Errorf("part %d '%s' has invalid hex length", i+1, part)
		}
	}

	// Parse hex values to int32
	value1, err1 := parseHexToInt32(strings.TrimSpace(parts[0]))
	value2, err2 := parseHexToInt32(strings.TrimSpace(parts[1]))
	value3, err3 := parseHexToInt32(strings.TrimSpace(parts[2]))

	if err1 != nil || err2 != nil || err3 != nil {
		return nil, fmt.Errorf("error parsing hex values: %v, %v, %v", err1, err2, err3)
	}

	log.Printf("Successfully parsed hex values: %d, %d, %d", value1, value2, value3)

	return &SensorData{
		Value1:    float64(value1),
		Value2:    float64(value2),
		Value3:    float64(value3),
		Timestamp: time.Now(),
	}, nil
}

// parseHexToInt32 parses a hex string to int32 (handles both positive and negative values)
func parseHexToInt32(hexStr string) (int32, error) {
	// Remove 0x prefix if present
	if strings.HasPrefix(hexStr, "0x") || strings.HasPrefix(hexStr, "0X") {
		hexStr = hexStr[2:]
	}

	// Parse as uint32 first to handle the full 32-bit range
	val, err := strconv.ParseUint(hexStr, 16, 32)
	if err != nil {
		return 0, fmt.Errorf("invalid hex value '%s': %v", hexStr, err)
	}

	// Convert uint32 to int32 (this properly handles negative values)
	return int32(val), nil
}

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}
