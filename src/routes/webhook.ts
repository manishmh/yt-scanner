import { YouTubeMonitor } from '@/services/youtube/monitor';
import { PubSubHubbubService } from '@/services/youtube/pubsubhubbub';
import { youtubeLogger } from '@/utils/logger';
import { Request, Response, Router } from 'express';

const router = Router();
const pubsubService = new PubSubHubbubService();

/**
 * YouTube webhook endpoint for PubSubHubbub notifications
 * Handles both verification challenges and actual notifications
 */
router.all('/youtube', async (req: Request, res: Response) => {
  try {
    const method = req.method;
    
    youtubeLogger.info('Received YouTube webhook request', {
      method,
      query: req.query,
      headers: {
        'content-type': req.headers['content-type'],
        'user-agent': req.headers['user-agent'],
        'x-hub-signature': req.headers['x-hub-signature']
      }
    });

    // Handle GET requests (verification challenges)
    if (method === 'GET') {
      const challenge = pubsubService.handleVerificationChallenge(req.query);
      
      if (challenge) {
        youtubeLogger.info('Responding to verification challenge', { challenge });
        res.status(200).send(challenge);
        return;
      } else {
        youtubeLogger.warn('Invalid verification challenge');
        res.status(404).send('Invalid challenge');
        return;
      }
    }

    // Handle POST requests (actual notifications)
    if (method === 'POST') {
      const body = req.body;
      const signature = req.headers['x-hub-signature'] as string;
      
      // Verify signature if present
      const isValidSignature = pubsubService.verifySignature(
        body, 
        signature, 
        process.env.WEBHOOK_SECRET
      );

      if (!isValidSignature) {
        youtubeLogger.warn('Invalid webhook signature');
        res.status(401).send('Invalid signature');
        return;
      }

      // Parse the notification
      const notification = await pubsubService.parseNotification(body);
      
      if (!notification) {
        youtubeLogger.warn('Could not parse notification');
        res.status(400).send('Invalid notification');
        return;
      }

      youtubeLogger.info('Received YouTube video notification', {
        videoId: notification.videoId,
        channelId: notification.channelId,
        title: notification.title,
        publishedAt: notification.publishedAt
      });

      // Process the new video
      await processNewVideo(notification);

      res.status(200).send('OK');
      return;
    }

    // Handle other methods
    res.status(405).send('Method not allowed');

  } catch (error) {
    youtubeLogger.error('Error handling YouTube webhook', error as Error);
    res.status(500).send('Internal server error');
  }
});

/**
 * Process a new video notification
 */
async function processNewVideo(notification: any) {
  try {
    youtubeLogger.info('Processing new video from push notification', {
      videoId: notification.videoId,
      title: notification.title
    });

    // Create a YouTube monitor instance to process the video
    const monitor = new YouTubeMonitor();
    
    // Get full video metadata first
    const videoMetadata = await monitor.getVideoMetadata(notification.videoId);
    
    if (videoMetadata) {
      // Process the video using the existing pipeline
      await monitor.processNewVideo(videoMetadata);
    } else {
      // Create minimal metadata if video details can't be fetched
      await monitor.processNewVideo({
        videoId: notification.videoId,
        title: notification.title,
        channelId: notification.channelId,
        publishedAt: notification.publishedAt,
        thumbnailUrl: `https://i.ytimg.com/vi/${notification.videoId}/maxresdefault.jpg`,
        description: '',
        duration: 'PT0S',
        viewCount: 0,
        likeCount: 0,
        commentCount: 0
      });
    }

    youtubeLogger.info('Successfully processed video from push notification', {
      videoId: notification.videoId
    });

  } catch (error) {
    youtubeLogger.error('Error processing new video from push notification', error as Error, {
      videoId: notification.videoId
    });
  }
}

/**
 * Subscribe to a channel endpoint
 */
router.post('/subscribe/:channelId', async (req: Request, res: Response) => {
  try {
    const { channelId } = req.params;
    const callbackUrl = pubsubService.getCallbackUrl();

    youtubeLogger.info('Manual subscription request', { channelId, callbackUrl });

    const success = await pubsubService.subscribeToChannel(channelId, callbackUrl);

    if (success) {
      res.json({
        success: true,
        message: 'Subscription request sent',
        channelId,
        callbackUrl
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send subscription request',
        channelId
      });
    }

  } catch (error) {
    youtubeLogger.error('Error in manual subscription', error as Error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Unsubscribe from a channel endpoint
 */
router.post('/unsubscribe/:channelId', async (req: Request, res: Response) => {
  try {
    const { channelId } = req.params;
    const callbackUrl = pubsubService.getCallbackUrl();

    youtubeLogger.info('Manual unsubscription request', { channelId, callbackUrl });

    const success = await pubsubService.unsubscribeFromChannel(channelId, callbackUrl);

    if (success) {
      res.json({
        success: true,
        message: 'Unsubscription request sent',
        channelId,
        callbackUrl
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send unsubscription request',
        channelId
      });
    }

  } catch (error) {
    youtubeLogger.error('Error in manual unsubscription', error as Error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Get subscription status
 */
router.get('/status/:channelId', async (req: Request, res: Response) => {
  try {
    const { channelId } = req.params;
    const subscriptionInfo = pubsubService.getSubscriptionInfo(channelId);

    res.json({
      success: true,
      data: subscriptionInfo
    });

  } catch (error) {
    youtubeLogger.error('Error getting subscription status', error as Error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router; 