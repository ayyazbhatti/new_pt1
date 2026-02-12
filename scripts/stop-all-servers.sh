#!/bin/bash

# Script to stop all trading platform servers

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PIDS_FILE="/tmp/trading-platform-pids.txt"

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

echo ""
echo "=========================================="
echo "  Trading Platform - Stop All Servers"
echo "=========================================="
echo ""

print_info "Stopping all services..."

# Stop processes from PID file
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
    print_status "Stopped processes from PID file"
else
    print_warning "No PID file found"
fi

# Kill any remaining cargo/vite processes
print_info "Stopping remaining cargo processes..."
pkill -f "cargo run" 2>/dev/null && print_status "Stopped cargo processes" || print_warning "No cargo processes found"

print_info "Stopping remaining vite processes..."
pkill -f "vite" 2>/dev/null && print_status "Stopped vite processes" || print_warning "No vite processes found"

# Optionally stop infrastructure (commented out by default)
# Uncomment if you want to stop Docker services too
# print_info "Stopping infrastructure services..."
# cd "$(dirname "$0")/../infra" || exit 1
# docker-compose down
# cd - > /dev/null
# print_status "Infrastructure services stopped"

echo ""
print_status "All services stopped!"
echo ""

