#!/usr/bin/env node

/**
 * Test script for YouTube channel monitoring
 * This script tests the basic functionality of monitoring a YouTube channel
 */

const { config } = require('../dist/config');
const { YouTubeMonitor } = require('../dist/services/youtube/monitor');

async function testChannelMonitoring() {
  console.log('🔍 Testing YouTube Channel Monitoring');
  console.log('=====================================');

  try {
    // Check if required environment variables are set
    console.log('\n1. Checking environment configuration...');
    
    if (!config.youtube.apiKey) {
      throw new Error('YOUTUBE_API_KEY is not set in environment variables');
    }
    
    if (!config.youtube.channelId) {
      throw new Error('YOUTUBE_CHANNEL_ID is not set in environment variables');
    }

    console.log('✅ YouTube API Key: Set');
    console.log('✅ YouTube Channel ID:', config.youtube.channelId);
    console.log('✅ Polling Interval:', config.youtube.pollingIntervalMinutes, 'minutes');

    // Initialize YouTube Monitor
    console.log('\n2. Initializing YouTube Monitor...');
    const monitor = new YouTubeMonitor();
    console.log('✅ YouTube Monitor initialized');

    // Test channel access
    console.log('\n3. Testing channel access...');
    console.log('Target Channel: @manishmalhotra8099');
    console.log('Channel ID:', config.youtube.channelId);

    // Get channel info
    console.log('\n4. Fetching channel information...');
    const channelInfo = await monitor.getChannelInfo(config.youtube.channelId);
    
    if (channelInfo) {
      console.log('✅ Channel found!');
      console.log('   - Title:', channelInfo.title);
      console.log('   - Subscriber Count:', channelInfo.subscriberCount || 'Hidden');
      console.log('   - Video Count:', channelInfo.videoCount);
      console.log('   - Description:', channelInfo.description?.substring(0, 100) + '...');
    } else {
      throw new Error('Channel not found or not accessible');
    }

    // Test getting recent videos
    console.log('\n5. Fetching recent videos...');
    const recentVideos = await monitor.getRecentVideos(config.youtube.channelId, 5);
    
    if (recentVideos && recentVideos.length > 0) {
      console.log(`✅ Found ${recentVideos.length} recent videos:`);
      
      recentVideos.forEach((video, index) => {
        console.log(`   ${index + 1}. ${video.title}`);
        console.log(`      - Video ID: ${video.videoId}`);
        console.log(`      - Published: ${video.publishedAt}`);
        console.log(`      - Thumbnail: ${video.thumbnailUrl}`);
        console.log('');
      });
    } else {
      console.log('⚠️  No recent videos found');
    }

    // Test thumbnail analysis on the first video (if available)
    if (recentVideos && recentVideos.length > 0) {
      console.log('\n6. Testing thumbnail analysis on first video...');
      const firstVideo = recentVideos[0];
      
      try {
        const { ThumbnailAnalyzer } = require('../dist/services/analysis/thumbnail');
        const thumbnailAnalyzer = new ThumbnailAnalyzer();
        
        const thumbnailResult = await thumbnailAnalyzer.analyzeThumbnail(
          firstVideo.thumbnailUrl, 
          firstVideo.videoId
        );
        
        console.log('✅ Thumbnail analysis completed:');
        console.log('   - Has Money Thumbnail:', thumbnailResult.hasMoneyThumbnail);
        console.log('   - Monetary Detections:', thumbnailResult.monetaryDetections.length);
        
        if (thumbnailResult.monetaryDetections.length > 0) {
          thumbnailResult.monetaryDetections.forEach((detection, index) => {
            console.log(`   - Detection ${index + 1}: $${detection.amount} (confidence: ${detection.confidence})`);
          });
        }
        
      } catch (error) {
        console.log('⚠️  Thumbnail analysis failed:', error.message);
      }
    }

    console.log('\n🎉 Channel monitoring test completed successfully!');
    console.log('\n📋 Next Steps:');
    console.log('1. Start the full application: npm run dev');
    console.log('2. Monitor logs: tail -f logs/app.log');
    console.log('3. Check API status: curl http://localhost:3000/health');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Check your .env file configuration');
    console.log('2. Verify YouTube API key is valid');
    console.log('3. Ensure channel ID is correct');
    console.log('4. Check network connectivity');
    console.log('5. Review CREDENTIALS_SETUP.md for detailed instructions');
    
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testChannelMonitoring().catch(console.error);
}

module.exports = { testChannelMonitoring }; 