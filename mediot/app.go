package main

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"go.bug.st/serial"
)

// App struct
type App struct {
	ctx         context.Context
	serialPort  serial.Port
	isConnected bool
	dataBuffer  []byte // Buffer to accumulate incoming data
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
	return &App{
		isConnected: false,
		dataBuffer:  make([]byte, 0),
	}
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

// ReadSensorData reads and parses sensor data from the serial port
func (a *App) ReadSensorData() (*SensorData, error) {
	if !a.isConnected || a.serialPort == nil {
		return nil, fmt.Errorf("not connected to serial port")
	}

	// Set read timeout
	a.serialPort.SetReadTimeout(100 * time.Millisecond)

	// Read available data from serial port
	tempBuffer := make([]byte, 100)
	n, err := a.serialPort.Read(tempBuffer)
	if err != nil {
		if !strings.Contains(err.Error(), "timeout") {
			log.Printf("Error reading from serial port: %v", err)
		}
		return nil, err
	}

	if n == 0 {
		return nil, fmt.Errorf("no data received")
	}

	// Try to parse as text format if data looks like text
	dataStr := string(tempBuffer[:n])
	if strings.Contains(dataStr, ",") && n < 100 {
		return a.parseTextFormat(strings.TrimSpace(dataStr))
	}

	// Try to parse as binary format if we have at least 12 bytes
	if n >= 12 {
		return a.parseBinaryFormat(tempBuffer[:12])
	}

	return nil, fmt.Errorf("insufficient data for parsing (got %d bytes)", n)
}

// containsTextData checks if buffer contains printable text that might be hex values
func (a *App) containsTextData() bool {
	if len(a.dataBuffer) < 3 {
		return false
	}

	// Check if data contains commas and mostly printable ASCII characters
	commaCount := 0
	printableCount := 0

	for _, b := range a.dataBuffer {
		if b == ',' {
			commaCount++
		}
		if b >= 32 && b <= 126 { // Printable ASCII range
			printableCount++
		}
	}

	// Consider it text if we have commas and mostly printable characters
	return commaCount >= 2 && float64(printableCount) > float64(len(a.dataBuffer))*0.8
}

// tryParseTextFormat attempts to parse accumulated buffer as text format
func (a *App) tryParseTextFormat() (*SensorData, error) {
	// Look for complete line (ending with newline or carriage return)
	dataStr := string(a.dataBuffer)

	// Find the end of a complete line
	endIdx := -1
	for i, char := range dataStr {
		if char == '\n' || char == '\r' {
			endIdx = i
			break
		}
	}

	if endIdx == -1 && len(dataStr) < 50 {
		// No complete line yet and buffer is small, wait for more data
		return nil, fmt.Errorf("waiting for complete text line")
	}

	var lineToProcess string
	if endIdx != -1 {
		lineToProcess = dataStr[:endIdx]
		// Remove processed data from buffer
		a.dataBuffer = a.dataBuffer[endIdx+1:]
	} else {
		// Process the whole buffer if it's getting large
		lineToProcess = dataStr
		a.dataBuffer = a.dataBuffer[:0]
	}

	return a.parseTextFormat(strings.TrimSpace(lineToProcess))
}

// tryParseBinaryFormat attempts to parse accumulated buffer as binary format
func (a *App) tryParseBinaryFormat() (*SensorData, error) {
	if len(a.dataBuffer) < 12 {
		return nil, fmt.Errorf("need at least 12 bytes for binary format")
	}

	// Take first 12 bytes for parsing
	data := a.dataBuffer[:12]
	result, err := a.parseBinaryFormat(data)

	if err == nil {
		// Successfully parsed, remove processed bytes from buffer
		a.dataBuffer = a.dataBuffer[12:]
	}

	return result, err
}

// parseTextFormat parses comma-separated hex values
func (a *App) parseTextFormat(dataStr string) (*SensorData, error) {
	// Expected format: "hex_value1,hex_value2,hex_value3" (e.g., "0x1A2B,0xFF00,0x5432")
	parts := strings.Split(dataStr, ",")
	if len(parts) < 3 {
		return nil, fmt.Errorf("invalid text format: expected 3 values, got %d", len(parts))
	}

	// Parse hex uint32 values
	value1, err1 := parseHexUint32(strings.TrimSpace(parts[0]))
	value2, err2 := parseHexUint32(strings.TrimSpace(parts[1]))
	value3, err3 := parseHexUint32(strings.TrimSpace(parts[2]))

	if err1 != nil || err2 != nil || err3 != nil {
		return nil, fmt.Errorf("error parsing hex values: %v, %v, %v", err1, err2, err3)
	}

	return &SensorData{
		Value1:    float64(value1),
		Value2:    float64(value2),
		Value3:    float64(value3),
		Timestamp: time.Now(),
	}, nil
}

// parseBinaryFormat parses binary data as three uint32 values
func (a *App) parseBinaryFormat(data []byte) (*SensorData, error) {
	// Expect at least 12 bytes for three uint32 values
	if len(data) < 12 {
		return nil, fmt.Errorf("insufficient binary data: need 12 bytes, got %d", len(data))
	}

	// Parse as little-endian uint32 values
	value1 := uint32(data[0]) | uint32(data[1])<<8 | uint32(data[2])<<16 | uint32(data[3])<<24
	value2 := uint32(data[4]) | uint32(data[5])<<8 | uint32(data[6])<<16 | uint32(data[7])<<24
	value3 := uint32(data[8]) | uint32(data[9])<<8 | uint32(data[10])<<16 | uint32(data[11])<<24

	log.Printf("Parsed binary values: %d, %d, %d", value1, value2, value3)

	return &SensorData{
		Value1:    float64(value1),
		Value2:    float64(value2),
		Value3:    float64(value3),
		Timestamp: time.Now(),
	}, nil
}

// parseHexUint32 parses a hex string (with or without 0x prefix) to uint32
func parseHexUint32(hexStr string) (uint32, error) {
	// Remove 0x prefix if present
	if strings.HasPrefix(hexStr, "0x") || strings.HasPrefix(hexStr, "0X") {
		hexStr = hexStr[2:]
	}

	// Parse as base 16 uint64, then convert to uint32
	val, err := strconv.ParseUint(hexStr, 16, 32)
	if err != nil {
		return 0, fmt.Errorf("invalid hex value '%s': %v", hexStr, err)
	}

	return uint32(val), nil
}

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}
