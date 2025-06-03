import { config } from '@/config';
import { youtubeLogger } from '@/utils/logger';
import crypto from 'crypto';
import { parseString } from 'xml2js';

export interface YouTubeNotification {
  videoId: string;
  channelId: string;
  title: string;
  publishedAt: string;
  updatedAt: string;
  link: string;
}

export interface SubscriptionInfo {
  channelId: string;
  callbackUrl: string;
  subscribed: boolean;
  subscribedAt?: string;
  expiresAt?: string;
  leaseSeconds?: number;
}

export class PubSubHubbubService {
  private readonly hubUrl = 'https://pubsubhubbub.appspot.com/subscribe';
  private readonly topicUrlBase = 'https://www.youtube.com/xml/feeds/videos.xml?channel_id=';
  
  constructor() {
    youtubeLogger.info('PubSubHubbub Service initialized');
  }

  /**
   * Subscribe to a YouTube channel for push notifications
   */
  async subscribeToChannel(
    channelId: string, 
    callbackUrl: string,
    leaseSeconds: number = 864000 // 10 days default
  ): Promise<boolean> {
    try {
      const topicUrl = `${this.topicUrlBase}${channelId}`;
      
      const formData = new URLSearchParams({
        'hub.callback': callbackUrl,
        'hub.topic': topicUrl,
        'hub.verify': 'async',
        'hub.mode': 'subscribe',
        'hub.lease_seconds': leaseSeconds.toString()
      });

      youtubeLogger.info('Subscribing to YouTube channel', {
        channelId,
        callbackUrl,
        topicUrl,
        leaseSeconds
      });

      const response = await fetch(this.hubUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'YT-Scanner/1.0'
        },
        body: formData.toString()
      });

      if (response.status === 202) {
        youtubeLogger.info('Subscription request accepted', {
          channelId,
          status: response.status
        });
        return true;
      } else {
        const responseText = await response.text();
        youtubeLogger.error('Subscription request failed', new Error(`HTTP ${response.status}`), {
          channelId,
          status: response.status,
          response: responseText
        });
        return false;
      }

    } catch (error) {
      youtubeLogger.error('Error subscribing to channel', error as Error, { channelId });
      return false;
    }
  }

  /**
   * Unsubscribe from a YouTube channel
   */
  async unsubscribeFromChannel(channelId: string, callbackUrl: string): Promise<boolean> {
    try {
      const topicUrl = `${this.topicUrlBase}${channelId}`;
      
      const formData = new URLSearchParams({
        'hub.callback': callbackUrl,
        'hub.topic': topicUrl,
        'hub.verify': 'async',
        'hub.mode': 'unsubscribe'
      });

      youtubeLogger.info('Unsubscribing from YouTube channel', {
        channelId,
        callbackUrl,
        topicUrl
      });

      const response = await fetch(this.hubUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'YT-Scanner/1.0'
        },
        body: formData.toString()
      });

      if (response.status === 202) {
        youtubeLogger.info('Unsubscription request accepted', {
          channelId,
          status: response.status
        });
        return true;
      } else {
        const responseText = await response.text();
        youtubeLogger.error('Unsubscription request failed', new Error(`HTTP ${response.status}`), {
          channelId,
          status: response.status,
          response: responseText
        });
        return false;
      }

    } catch (error) {
      youtubeLogger.error('Error unsubscribing from channel', error as Error, { channelId });
      return false;
    }
  }

  /**
   * Handle verification challenge from YouTube hub
   */
  handleVerificationChallenge(query: any): string | null {
    const { 'hub.mode': mode, 'hub.topic': topic, 'hub.challenge': challenge, 'hub.lease_seconds': leaseSeconds } = query;

    youtubeLogger.info('Received verification challenge', {
      mode,
      topic,
      challenge: challenge ? 'present' : 'missing',
      leaseSeconds
    });

    // Verify that this is a subscription we expect
    if (mode === 'subscribe' || mode === 'unsubscribe') {
      if (topic && topic.includes('youtube.com/xml/feeds/videos.xml')) {
        youtubeLogger.info('Verification challenge accepted', { mode, topic });
        return challenge;
      }
    }

    youtubeLogger.warn('Verification challenge rejected', { mode, topic });
    return null;
  }

  /**
   * Parse YouTube Atom feed notification
   */
  async parseNotification(xmlBody: string): Promise<YouTubeNotification | null> {
    try {
      return new Promise((resolve, reject) => {
        parseString(xmlBody, (err, result) => {
          if (err) {
            youtubeLogger.error('Error parsing XML notification', err);
            reject(err);
            return;
          }

          try {
            // YouTube Atom feed structure
            const feed = result.feed;
            if (!feed || !feed.entry || !feed.entry[0]) {
              youtubeLogger.warn('No entry found in notification', { xmlBody });
              resolve(null);
              return;
            }

            const entry = feed.entry[0];
            
            // Extract video information
            const videoId = this.extractVideoId(entry);
            const channelId = this.extractChannelId(entry);
            const title = entry.title?.[0]?._ || entry.title?.[0] || 'Unknown Title';
            const publishedAt = entry.published?.[0] || new Date().toISOString();
            const updatedAt = entry.updated?.[0] || new Date().toISOString();
            const link = entry.link?.[0]?.$?.href || '';

            if (!videoId || !channelId) {
              youtubeLogger.warn('Missing required fields in notification', {
                videoId,
                channelId,
                title
              });
              resolve(null);
              return;
            }

            const notification: YouTubeNotification = {
              videoId,
              channelId,
              title,
              publishedAt,
              updatedAt,
              link
            };

            youtubeLogger.info('Parsed YouTube notification', {
              videoId: notification.videoId,
              channelId: notification.channelId,
              title: notification.title,
              publishedAt: notification.publishedAt
            });
            resolve(notification);

          } catch (parseError) {
            youtubeLogger.error('Error extracting data from parsed XML', parseError as Error);
            reject(parseError);
          }
        });
      });

    } catch (error) {
      youtubeLogger.error('Error parsing notification', error as Error);
      return null;
    }
  }

  /**
   * Extract video ID from Atom entry
   */
  private extractVideoId(entry: any): string | null {
    // Try different possible locations for video ID
    if (entry['yt:videoId']?.[0]) {
      return entry['yt:videoId'][0];
    }
    
    if (entry.id?.[0]) {
      const id = entry.id[0];
      // Extract from yt:video:VIDEO_ID format
      const match = id.match(/yt:video:([a-zA-Z0-9_-]+)/);
      if (match) {
        return match[1];
      }
    }

    if (entry.link?.[0]?.$?.href) {
      const href = entry.link[0].$.href;
      // Extract from YouTube URL
      const match = href.match(/[?&]v=([a-zA-Z0-9_-]+)/);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Extract channel ID from Atom entry
   */
  private extractChannelId(entry: any): string | null {
    // Try different possible locations for channel ID
    if (entry['yt:channelId']?.[0]) {
      return entry['yt:channelId'][0];
    }

    if (entry.author?.[0]?.uri?.[0]) {
      const uri = entry.author[0].uri[0];
      // Extract from channel URI
      const match = uri.match(/channel\/([a-zA-Z0-9_-]+)/);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Verify webhook signature (if provided by YouTube)
   */
  verifySignature(body: string, signature: string, secret?: string): boolean {
    if (!secret || !signature) {
      // If no secret is configured, skip verification
      return true;
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha1', secret)
        .update(body)
        .digest('hex');

      const providedSignature = signature.replace('sha1=', '');
      
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(providedSignature, 'hex')
      );
    } catch (error) {
      youtubeLogger.error('Error verifying webhook signature', error as Error);
      return false;
    }
  }

  /**
   * Get subscription info for a channel
   */
  getSubscriptionInfo(channelId: string): SubscriptionInfo {
    // This would typically be stored in a database
    // For now, return basic info
    return {
      channelId,
      callbackUrl: `${this.getCallbackBaseUrl()}/api/webhook/youtube`,
      subscribed: false
    };
  }

  /**
   * Get the callback base URL for webhooks
   */
  private getCallbackBaseUrl(): string {
    // In production, this should be your actual domain
    // For development, you might use ngrok or similar
    const baseUrl = process.env.WEBHOOK_BASE_URL || `http://localhost:${config.server.port}`;
    return baseUrl;
  }

  /**
   * Get the full callback URL for a channel
   */
  getCallbackUrl(): string {
    return `${this.getCallbackBaseUrl()}/api/webhook/youtube`;
  }
} 