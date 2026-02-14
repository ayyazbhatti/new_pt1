#!/bin/bash

# WebSocket Balance Test Script
# Tests balance updates for user: ayyazbhatti3@gmail.com
# User ID: fa586515-f90d-4a5a-b6ed-db3cf8dae6b8

TOKEN="eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYTU4NjUxNS1mOTBkLTRhNWEtYjZlZC1kYjNjZjhkYWU2YjgiLCJlbWFpbCI6ImF5eWF6YmhhdHRpM0BnbWFpbC5jb20iLCJyb2xlIjoidXNlciIsImV4cCI6MTc3MDk3Nzk4MCwiaWF0IjoxNzcwOTc3MDgwfQ.-hAODAW1UVEwuiMWl9oSokl5ZfgTKAFvzIPvmTCwb-Q"
WS_URL="ws://localhost:3003/ws?group=default"

echo "🔌 Testing WebSocket Balance Updates"
echo "===================================="
echo "User: ayyazbhatti3@gmail.com"
echo "User ID: fa586515-f90d-4a5a-b6ed-db3cf8dae6b8"
echo "WebSocket: $WS_URL"
echo ""

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js to run this test."
    exit 1
fi

# Check if ws package is available, if not install it
if ! node -e "require('ws')" 2>/dev/null; then
    echo "📦 Installing 'ws' package..."
    npm install ws --save-dev 2>/dev/null || {
        echo "❌ Failed to install 'ws' package. Please run: npm install ws"
        exit 1
    }
fi

# Run the test script
node test-websocket-balance.js

