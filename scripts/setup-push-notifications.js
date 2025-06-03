const { PubSubHubbubService } = require('../src/services/youtube/pubsubhubbub');
const { config } = require('../src/config');

async function setupPushNotifications() {
  console.log('Setting up YouTube Push Notifications...');
  
  const pubsubService = new PubSubHubbubService();
  const channelId = config.youtube.channelId;
  const callbackUrl = pubsubService.getCallbackUrl();

  console.log(`Channel ID: ${channelId}`);
  console.log(`Callback URL: ${callbackUrl}`);
  console.log('');

  console.log('IMPORTANT: Make sure your server is running and accessible at the callback URL!');
  console.log('For local development, you may need to use ngrok or similar tunneling service.');
  console.log('');

  try {
    console.log('Subscribing to YouTube channel...');
    const success = await pubsubService.subscribeToChannel(channelId, callbackUrl);

    if (success) {
      console.log('✅ Subscription request sent successfully!');
      console.log('YouTube will send a verification challenge to your webhook endpoint.');
      console.log('Check your server logs for the verification process.');
    } else {
      console.log('❌ Failed to send subscription request.');
      console.log('Check your network connection and callback URL.');
    }

  } catch (error) {
    console.error('❌ Error setting up push notifications:', error.message);
  }
}

// Check if we need to set up ngrok for local development
function checkLocalSetup() {
  const callbackUrl = process.env.WEBHOOK_BASE_URL || `http://localhost:${config.server.port}`;
  
  if (callbackUrl.includes('localhost') || callbackUrl.includes('127.0.0.1')) {
    console.log('⚠️  WARNING: You are using a localhost URL for webhooks.');
    console.log('YouTube cannot reach localhost URLs. You need to:');
    console.log('1. Use ngrok: npx ngrok http 3000');
    console.log('2. Set WEBHOOK_BASE_URL environment variable to your ngrok URL');
    console.log('3. Example: export WEBHOOK_BASE_URL=https://abc123.ngrok.io');
    console.log('');
    return false;
  }
  
  return true;
}

if (require.main === module) {
  if (checkLocalSetup()) {
    setupPushNotifications();
  }
}

module.exports = { setupPushNotifications, checkLocalSetup }; 