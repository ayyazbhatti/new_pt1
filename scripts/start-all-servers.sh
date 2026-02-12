#!/bin/bash

# Comprehensive script to start all trading platform servers
# This script starts infrastructure, backend services, and frontend

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Port configuration
AUTH_SERVICE_PORT=3000
DATA_PROVIDER_PORT=3001
ORDER_ENGINE_PORT=3002
GATEWAY_WS_PORT=3003
CORE_API_PORT=3004
FRONTEND_PORT=5173

# PID file to track all processes
PIDS_FILE="/tmp/trading-platform-pids.txt"
> "$PIDS_FILE" # Clear the file

# Function to print colored messages
print_status() {
    echo -e "${GREEN}✅${NC} $1"
}

print_error() {
    echo -e "${RED}❌${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠️${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ️${NC} $1"
}

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0  # Port is in use
    else
        return 1  # Port is free
    fi
}

# Function to wait for a service to be ready
wait_for_service() {
    local url=$1
    local name=$2
    local max_attempts=30
    local attempt=0
    
    print_info "Waiting for $name to be ready..."
    while [ $attempt -lt $max_attempts ]; do
        if curl -s "$url" > /dev/null 2>&1; then
            print_status "$name is ready!"
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 1
    done
    
    print_warning "$name did not become ready after ${max_attempts} seconds"
    return 1
}

# Function to start a service and track its PID
start_service() {
    local name=$1
    local command=$2
    local port=$3
    local health_url=$4
    
    # Check if port is already in use
    if check_port $port; then
        print_warning "Port $port is already in use. Skipping $name"
        return 1
    fi
    
    print_info "Starting $name on port $port..."
    
    # Start the service in background
    eval "$command" > "/tmp/${name}.log" 2>&1 &
    local pid=$!
    echo $pid >> "$PIDS_FILE"
    
    print_status "$name started with PID $pid"
    
    # Wait for service to be ready if health URL is provided
    if [ -n "$health_url" ]; then
        sleep 2  # Give it a moment to start
        wait_for_service "$health_url" "$name" || true
    else
        sleep 2  # Give it a moment to start
    fi
    
    return 0
}

# Cleanup function
cleanup() {
    echo ""
    print_info "Shutting down all services..."
    
    if [ -f "$PIDS_FILE" ]; then
        while read pid; do
            if ps -p $pid > /dev/null 2>&1; then
                print_info "Stopping process $pid..."
                kill $pid 2>/dev/null || true
            fi
        done < "$PIDS_FILE"
        
        # Wait a bit, then force kill if still running
        sleep 2
        while read pid; do
            if ps -p $pid > /dev/null 2>&1; then
                print_warning "Force killing process $pid..."
                kill -9 $pid 2>/dev/null || true
            fi
        done < "$PIDS_FILE"
        
        rm -f "$PIDS_FILE"
    fi
    
    # Kill any remaining cargo/vite processes
    pkill -f "cargo run" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    
    print_status "All services stopped"
    exit 0
}

# Set up trap for cleanup on exit
trap cleanup INT TERM EXIT

# Main execution
echo ""
echo "=========================================="
echo "  Trading Platform - Start All Servers"
echo "=========================================="
echo ""

# Check prerequisites
print_info "Checking prerequisites..."

# Check Docker
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running!"
    print_info "Please start Docker Desktop and try again"
    exit 1
fi
print_status "Docker is running"

# Check Cargo
if ! command -v cargo &> /dev/null; then
    print_error "Cargo is not installed!"
    exit 1
fi
print_status "Cargo is available"

# Check npm
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed!"
    exit 1
fi
print_status "npm is available"

echo ""

# Step 1: Start Infrastructure
print_info "Step 1: Starting Infrastructure Services..."
cd "$(dirname "$0")/../infra" || exit 1

if docker-compose ps | grep -q "Up"; then
    print_warning "Infrastructure services are already running"
else
    docker-compose up -d
    print_status "Infrastructure services started"
    sleep 3  # Wait for services to initialize
fi

cd - > /dev/null

# Verify infrastructure
print_info "Verifying infrastructure..."
if check_port 4222; then
    print_status "NATS is running on port 4222"
else
    print_warning "NATS is not running on port 4222"
fi

if check_port 6379; then
    print_status "Redis is running on port 6379"
else
    print_warning "Redis is not running on port 6379"
fi

if check_port 5432; then
    print_status "Postgres is running on port 5432"
else
    print_warning "Postgres is not running on port 5432"
fi

echo ""

# Step 2: Start Backend Services
print_info "Step 2: Starting Backend Services..."

# Set common environment variables
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/trading}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export NATS_URL="${NATS_URL:-nats://localhost:4222}"

# Start Auth Service (port 3000)
cd "$(dirname "$0")/../backend/auth-service" || exit 1
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi
export PORT=$AUTH_SERVICE_PORT
export JWT_SECRET="${JWT_SECRET:-dev-jwt-secret-key-change-in-production-minimum-32-characters-long}"
export JWT_ISSUER="${JWT_ISSUER:-newpt}"
start_service "Auth Service" "cargo run --bin auth-service" $AUTH_SERVICE_PORT "http://localhost:$AUTH_SERVICE_PORT/health"
cd - > /dev/null

# Start Data Provider (port 3001)
cd "$(dirname "$0")/.." || exit 1
export PORT=$DATA_PROVIDER_PORT
start_service "Data Provider" "cargo run -p data-provider" $DATA_PROVIDER_PORT "http://localhost:$DATA_PROVIDER_PORT/health"

# Start Order Engine (port 3002)
export PORT=$ORDER_ENGINE_PORT
start_service "Order Engine" "cargo run -p order-engine" $ORDER_ENGINE_PORT "http://localhost:$ORDER_ENGINE_PORT/health"

# Start Gateway WS (port 3003)
export PORT=$GATEWAY_WS_PORT
start_service "Gateway WS" "cargo run -p gateway-ws" $GATEWAY_WS_PORT "http://localhost:$GATEWAY_WS_PORT/health"

# Start Core API (port 3004)
export PORT=$CORE_API_PORT
start_service "Core API" "cargo run -p core-api" $CORE_API_PORT "http://localhost:$CORE_API_PORT/health"

echo ""

# Step 3: Start Frontend
print_info "Step 3: Starting Frontend..."
cd "$(dirname "$0")/.." || exit 1

if check_port $FRONTEND_PORT; then
    print_warning "Port $FRONTEND_PORT is already in use. Frontend may already be running"
else
    npm run dev > "/tmp/frontend.log" 2>&1 &
    local frontend_pid=$!
    echo $frontend_pid >> "$PIDS_FILE"
    print_status "Frontend started with PID $frontend_pid"
    sleep 3  # Give Vite time to start
fi

echo ""

# Final Status
echo "=========================================="
echo "  All Services Started!"
echo "=========================================="
echo ""
echo "📋 Service Status:"
echo ""
echo "  Infrastructure:"
echo "    - NATS:        nats://localhost:4222"
echo "    - Redis:       redis://localhost:6379"
echo "    - Postgres:    postgresql://localhost:5432"
echo ""
echo "  Backend Services:"
echo "    - Auth Service:    http://localhost:$AUTH_SERVICE_PORT"
echo "    - Data Provider:   http://localhost:$DATA_PROVIDER_PORT/health"
echo "    - Order Engine:    http://localhost:$ORDER_ENGINE_PORT/health"
echo "    - Gateway WS:      ws://localhost:$GATEWAY_WS_PORT/ws"
echo "    - Core API:        http://localhost:$CORE_API_PORT/health"
echo ""
echo "  Frontend:"
echo "    - Web UI:          http://localhost:$FRONTEND_PORT"
echo ""
echo "📝 Logs are available in /tmp/<service-name>.log"
echo ""
print_info "Press Ctrl+C to stop all services"
echo ""

# Keep script running and wait for interrupt
# Monitor processes and keep script alive
while true; do
    sleep 1
    # Check if any tracked processes are still running
    if [ -f "$PIDS_FILE" ]; then
        all_dead=true
        while read pid; do
            if ps -p $pid > /dev/null 2>&1; then
                all_dead=false
                break
            fi
        done < "$PIDS_FILE"
        
        if [ "$all_dead" = true ]; then
            print_warning "All services have stopped"
            break
        fi
    fi
done

