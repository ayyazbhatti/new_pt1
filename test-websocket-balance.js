// WebSocket Test Script for Balance Updates
// Run with: node test-websocket-balance.js

const WebSocket = require('ws');

const WS_URL = 'ws://localhost:3003/ws?group=default';
const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYTU4NjUxNS1mOTBkLTRhNWEtYjZlZC1kYjNjZjhkYWU2YjgiLCJlbWFpbCI6ImF5eWF6YmhhdHRpM0BnbWFpbC5jb20iLCJyb2xlIjoidXNlciIsImV4cCI6MTc3MDk3Nzk4MCwiaWF0IjoxNzcwOTc3MDgwfQ.-hAODAW1UVEwuiMWl9oSokl5ZfgTKAFvzIPvmTCwb-Q';

console.log('🔌 Connecting to WebSocket:', WS_URL);
const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✅ WebSocket connected');
  
  // Step 1: Authenticate
  console.log('\n🔐 Sending authentication...');
  ws.send(JSON.stringify({
    type: 'auth',
    token: TOKEN
  }));
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    console.log('\n📨 Received message:', JSON.stringify(message, null, 2));
    
    if (message.type === 'auth_success') {
      console.log('✅ Authentication successful!');
      console.log('   User ID:', message.user_id);
      console.log('   Group ID:', message.group_id);
      
      // Step 2: Subscribe to wallet balance updates
      console.log('\n📡 Subscribing to wallet balance channel...');
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'subscribe',
          channels: ['balances', 'wallet'],
          symbols: []
        }));
        console.log('✅ Subscription message sent');
      }, 500);
    } else if (message.type === 'auth_error') {
      console.error('❌ Authentication failed:', message.error);
      ws.close();
    } else if (message.type === 'wallet.balance.updated') {
      console.log('\n💰 BALANCE UPDATE RECEIVED!');
      console.log('   User ID:', message.payload?.userId);
      console.log('   Balance:', message.payload?.balance);
      console.log('   Currency:', message.payload?.currency);
      console.log('   Available:', message.payload?.available);
      console.log('   Locked:', message.payload?.locked);
      console.log('   Equity:', message.payload?.equity);
      console.log('   Margin Used:', message.payload?.margin_used);
      console.log('   Full payload:', JSON.stringify(message.payload, null, 2));
    } else if (message.type === 'subscribed') {
      console.log('✅ Subscription confirmed');
      console.log('   Waiting for balance updates...');
    } else if (message.type === 'error') {
      console.error('❌ Error:', message.message);
    }
  } catch (error) {
    console.error('❌ Failed to parse message:', error);
    console.log('Raw message:', data.toString());
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', (code, reason) => {
  console.log(`\n🔌 WebSocket closed. Code: ${code}, Reason: ${reason || 'No reason'}`);
  process.exit(0);
});

// Keep the script running
console.log('\n⏳ Waiting for messages... (Press Ctrl+C to exit)\n');

// Timeout after 30 seconds if no balance received
setTimeout(() => {
  console.log('\n⏰ 30 seconds elapsed. Closing connection...');
  ws.close();
}, 30000);

