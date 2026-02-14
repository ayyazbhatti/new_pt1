// Direct WebSocket test with JWT token
import WebSocket from 'ws';

const JWT_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYTU4NjUxNS1mOTBkLTRhNWEtYjZlZC1kYjNjZjhkYWU2YjgiLCJlbWFpbCI6ImF5eWF6YmhhdHRpM0BnbWFpbC5jb20iLCJyb2xlIjoidXNlciIsImV4cCI6MTc3MDk3Nzk4MCwiaWF0IjoxNzcwOTc3MDgwfQ.-hAODAW1UVEwuiMWl9oSokl5ZfgTKAFvzIPvmTCwb-Q';

// Decode JWT to get user ID
const payload = JSON.parse(Buffer.from(JWT_TOKEN.split('.')[1], 'base64').toString());
const USER_ID = payload.sub;
console.log('🔍 Testing WebSocket for User ID:', USER_ID);
console.log('📧 Email:', payload.email);
console.log('⏰ Token expires:', new Date(payload.exp * 1000).toISOString());
console.log('');

const WS_URL = process.env.VITE_WS_URL || 'ws://localhost:3003/ws?group=default';
console.log('🔌 Connecting to:', WS_URL);
console.log('');

const ws = new WebSocket(WS_URL);

let authenticated = false;
let subscribed = false;

ws.on('open', () => {
  console.log('✅ WebSocket opened');
  console.log('🔐 Sending authentication...');
  
  // Authenticate
  ws.send(JSON.stringify({
    type: 'auth',
    token: JWT_TOKEN
  }));
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    console.log('📨 Received message:', JSON.stringify(message, null, 2));
    
    if (message.type === 'auth_success') {
      authenticated = true;
      console.log('✅ Authentication successful!');
      console.log('   User ID from auth_success:', message.user_id);
      console.log('   Expected User ID:', USER_ID);
      console.log('   Match:', message.user_id === USER_ID);
      console.log('');
      
      // Subscribe to channels
      setTimeout(() => {
        console.log('📡 Subscribing to balances and wallet channels...');
        ws.send(JSON.stringify({
          type: 'subscribe',
          channels: ['balances', 'wallet'],
          symbols: []
        }));
        subscribed = true;
      }, 500);
    } else if (message.type === 'auth_error') {
      console.error('❌ Authentication failed:', message.error);
      ws.close();
    } else if (message.type === 'wallet.balance.updated') {
      console.log('');
      console.log('💰💰💰 BALANCE UPDATE RECEIVED 💰💰💰');
      console.log('Payload:', JSON.stringify(message.payload, null, 2));
      
      const payload = message.payload;
      const eventUserId = payload.userId || payload.user_id;
      console.log('');
      console.log('🔍 User ID Comparison:');
      console.log('   Event User ID:', eventUserId);
      console.log('   Expected User ID:', USER_ID);
      console.log('   Match:', eventUserId === USER_ID);
      
      // Normalize for comparison
      const normalize = (id) => id ? id.toString().trim().toLowerCase().replace(/-/g, '') : '';
      const normalizedEvent = normalize(eventUserId);
      const normalizedExpected = normalize(USER_ID);
      console.log('   Normalized Event ID:', normalizedEvent);
      console.log('   Normalized Expected ID:', normalizedExpected);
      console.log('   Normalized Match:', normalizedEvent === normalizedExpected);
      console.log('');
      
      if (normalizedEvent === normalizedExpected) {
        console.log('✅✅✅ USER ID MATCHES - BALANCE SHOULD UPDATE ✅✅✅');
        console.log('Balance:', payload.balance || payload.available);
        console.log('Currency:', payload.currency);
        console.log('Equity:', payload.equity);
        console.log('Margin Used:', payload.margin_used || payload.marginUsed);
      } else {
        console.log('❌❌❌ USER ID MISMATCH - BALANCE WON\'T UPDATE ❌❌❌');
      }
    } else if (message.type === 'subscribed') {
      console.log('✅ Subscribed to channels');
      console.log('⏳ Waiting for balance update...');
      console.log('');
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
  console.log('');
  console.log('🔌 WebSocket closed');
  console.log('   Code:', code);
  console.log('   Reason:', reason.toString());
  
  if (!authenticated) {
    console.log('');
    console.log('⚠️  WebSocket closed before authentication');
    console.log('   Check if ws-gateway is running on port 3003');
  } else if (!subscribed) {
    console.log('');
    console.log('⚠️  WebSocket closed before subscription');
  }
});

// Timeout after 30 seconds
setTimeout(() => {
  if (ws.readyState === WebSocket.OPEN) {
    console.log('');
    console.log('⏰ 30 seconds elapsed, closing connection...');
    ws.close();
  }
  process.exit(0);
}, 30000);

console.log('⏳ Waiting for messages (30 second timeout)...');
console.log('');

