import { config } from '@/config';
import { ProcessingJob, VideoMetadata } from '@/types';
import { youtubeLogger } from '@/utils/logger';
import { PubSub } from '@google-cloud/pubsub';
import { google, youtube_v3 } from 'googleapis';
import cron from 'node-cron';
import { PubSubHubbubService } from './pubsubhubbub';

export class YouTubeMonitor {
  private youtube: youtube_v3.Youtube;
  private pubsub: PubSub;
  private pubsubhubbub: PubSubHubbubService;
  private lastVideoCheckTime: Map<string, string> = new Map();
  private cronJob: any = null;
  private pushNotificationsEnabled: boolean = false;

  constructor() {
    this.youtube = google.youtube({
      version: 'v3',
      auth: config.youtube.apiKey,
    });

    this.pubsub = new PubSub({
      projectId: config.googleCloud.projectId,
    });

    this.pubsubhubbub = new PubSubHubbubService();

    youtubeLogger.info('YouTube Monitor initialized', {
      channelId: config.youtube.channelId,
      checkInterval: '5 minutes (fallback)',
      pushNotifications: 'will attempt to enable'
    });
  }

  /**
   * Start monitoring the configured YouTube channel
   */
  async startMonitoring(): Promise<void> {
    try {
      // Initialize last check time
      const now = new Date().toISOString();
      this.lastVideoCheckTime.set(config.youtube.channelId, now);

      youtubeLogger.info('Starting YouTube channel monitoring', {
        channelId: config.youtube.channelId
      });

      // Try to enable push notifications first
      await this.enablePushNotifications();

      // Schedule periodic checks as fallback (every 5 minutes)
      this.cronJob = cron.schedule('*/5 * * * *', async () => {
        if (!this.pushNotificationsEnabled) {
          youtubeLogger.debug('Running fallback polling check');
          await this.checkForNewVideos();
        } else {
          youtubeLogger.debug('Push notifications active, skipping polling');
        }
      });

      // Initial check if push notifications failed
      if (!this.pushNotificationsEnabled) {
        await this.checkForNewVideos();
      }

    } catch (error) {
      youtubeLogger.error('Failed to start monitoring', error as Error, {
        channelId: config.youtube.channelId
      });
      throw error;
    }
  }

  /**
   * Check for new videos since the last check
   */
  private async checkForNewVideos(): Promise<void> {
    const channelId = config.youtube.channelId;
    const lastCheck = this.lastVideoCheckTime.get(channelId) || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    try {
      youtubeLogger.info('Checking for new videos', {
        channelId,
        lastCheck
      });

      const videos = await this.getChannelVideos(channelId, lastCheck);
      
      if (videos.length > 0) {
        youtubeLogger.info(`Found ${videos.length} new videos`, {
          channelId,
          videoIds: videos.map(v => v.videoId)
        });

        for (const video of videos) {
          await this.processNewVideo(video);
        }
      } else {
        youtubeLogger.debug('No new videos found', { channelId });
      }

      // Update last check time
      this.lastVideoCheckTime.set(channelId, new Date().toISOString());

    } catch (error) {
      youtubeLogger.error('Error checking for new videos', error as Error, {
        channelId
      });
    }
  }

  /**
   * Get videos from a channel published after a specific time
   */
  private async getChannelVideos(channelId: string, publishedAfter: string): Promise<VideoMetadata[]> {
    try {
      const response = await this.youtube.search.list({
        part: ['snippet'],
        channelId,
        publishedAfter,
        order: 'date',
        type: ['video'],
        maxResults: 10,
      });

      if (!response.data.items) {
        return [];
      }

      const videoIds = response.data.items
        .map(item => item.id?.videoId)
        .filter((id): id is string => Boolean(id));

      if (videoIds.length === 0) {
        return [];
      }

      // Get detailed video information
      const detailsResponse = await this.youtube.videos.list({
        part: ['snippet', 'statistics', 'contentDetails'],
        id: videoIds,
      });

      const videos: VideoMetadata[] = [];

      for (const item of detailsResponse.data.items || []) {
        if (!item.id) continue;

        const video: VideoMetadata = {
          videoId: item.id,
          channelId: item.snippet?.channelId || channelId,
          title: item.snippet?.title || 'Unknown',
          description: item.snippet?.description || '',
          publishedAt: item.snippet?.publishedAt || new Date().toISOString(),
          thumbnailUrl: item.snippet?.thumbnails?.maxres?.url || 
                       item.snippet?.thumbnails?.high?.url || 
                       item.snippet?.thumbnails?.medium?.url || '',
          duration: item.contentDetails?.duration || 'PT0S',
          viewCount: parseInt(item.statistics?.viewCount || '0', 10),
          likeCount: parseInt(item.statistics?.likeCount || '0', 10),
          commentCount: parseInt(item.statistics?.commentCount || '0', 10),
        };

        videos.push(video);
      }

      return videos;

    } catch (error) {
      youtubeLogger.error('Error fetching channel videos', error as Error, {
        channelId,
        publishedAfter
      });
      throw error;
    }
  }

  /**
   * Enable push notifications via PubSubHubbub
   */
  private async enablePushNotifications(): Promise<void> {
    try {
      const channelId = config.youtube.channelId;
      const callbackUrl = this.pubsubhubbub.getCallbackUrl();

      youtubeLogger.info('Attempting to enable push notifications', {
        channelId,
        callbackUrl
      });

      const success = await this.pubsubhubbub.subscribeToChannel(channelId, callbackUrl);

      if (success) {
        this.pushNotificationsEnabled = true;
        youtubeLogger.info('Push notifications enabled successfully', {
          channelId,
          callbackUrl
        });
      } else {
        youtubeLogger.warn('Failed to enable push notifications, falling back to polling', {
          channelId
        });
      }

    } catch (error) {
      youtubeLogger.error('Error enabling push notifications', error as Error);
      this.pushNotificationsEnabled = false;
    }
  }

  /**
   * Disable push notifications
   */
  async disablePushNotifications(): Promise<void> {
    try {
      const channelId = config.youtube.channelId;
      const callbackUrl = this.pubsubhubbub.getCallbackUrl();

      youtubeLogger.info('Disabling push notifications', {
        channelId,
        callbackUrl
      });

      const success = await this.pubsubhubbub.unsubscribeFromChannel(channelId, callbackUrl);

      if (success) {
        this.pushNotificationsEnabled = false;
        youtubeLogger.info('Push notifications disabled successfully');
      } else {
        youtubeLogger.warn('Failed to disable push notifications');
      }

    } catch (error) {
      youtubeLogger.error('Error disabling push notifications', error as Error);
    }
  }

  /**
   * Process a newly detected video (can be called from polling or push notifications)
   */
  async processNewVideo(video: VideoMetadata): Promise<void> {
    try {
      youtubeLogger.videoInfo(video.videoId, 'Processing new video', {
        title: video.title,
        publishedAt: video.publishedAt,
        thumbnailUrl: video.thumbnailUrl
      });

      // Quick thumbnail pre-analysis to determine if we should process
      const shouldProcess = await this.shouldProcessVideo(video);

      if (!shouldProcess) {
        youtubeLogger.videoInfo(video.videoId, 'Skipping video - no monetary indicators in thumbnail');
        return;
      }

      // Create processing job
      const job: ProcessingJob = {
        id: `job_${video.videoId}_${Date.now()}`,
        videoId: video.videoId,
        status: 'pending',
        type: 'full',
        priority: 'high',
        createdAt: new Date().toISOString(),
      };

      // Publish to Pub/Sub for processing
      await this.publishVideoForProcessing(video, job);

      youtubeLogger.videoInfo(video.videoId, 'Video queued for processing', {
        jobId: job.id,
        priority: job.priority
      });

    } catch (error) {
      youtubeLogger.videoError(video.videoId, 'Error processing new video', error as Error);
    }
  }

  /**
   * Quick thumbnail analysis to determine if video should be processed
   */
  private async shouldProcessVideo(video: VideoMetadata): Promise<boolean> {
    if (!video.thumbnailUrl) {
      return false;
    }

    try {
      // Basic heuristics - process if:
      // 1. Title contains money-related keywords
      // 2. Always process if it's a recent video (within last hour)
      // 3. Video has high engagement

      const moneyKeywords = ['$', 'dollar', 'money', 'cash', 'gift', 'giveaway', 'win', 'free'];
      const titleLower = video.title.toLowerCase();
      const hasMoneyKeywords = moneyKeywords.some(keyword => titleLower.includes(keyword));

      const isRecent = Date.now() - new Date(video.publishedAt).getTime() < 60 * 60 * 1000; // 1 hour
      const hasHighEngagement = (video.viewCount || 0) > 1000 || (video.likeCount || 0) > 100;

      const shouldProcess = hasMoneyKeywords || isRecent || hasHighEngagement;

      youtubeLogger.debug('Video processing decision', {
        videoId: video.videoId,
        hasMoneyKeywords,
        isRecent,
        hasHighEngagement,
        shouldProcess
      });

      return shouldProcess;

    } catch (error) {
      youtubeLogger.videoError(video.videoId, 'Error in pre-processing analysis', error as Error);
      // If analysis fails, process the video to be safe
      return true;
    }
  }

  /**
   * Publish video metadata to Pub/Sub for processing
   */
  private async publishVideoForProcessing(video: VideoMetadata, job: ProcessingJob): Promise<void> {
    try {
      const topic = this.pubsub.topic(config.pubsub.topicNewVideo);
      
      const message = {
        video,
        job,
        timestamp: new Date().toISOString(),
        source: 'youtube-monitor'
      };

      const messageBuffer = Buffer.from(JSON.stringify(message));
      const messageId = await topic.publishMessage({ data: messageBuffer });

      youtubeLogger.info('Video published to Pub/Sub', {
        videoId: video.videoId,
        jobId: job.id,
        messageId,
        topic: config.pubsub.topicNewVideo
      });

    } catch (error) {
      youtubeLogger.error('Failed to publish video to Pub/Sub', error as Error, {
        videoId: video.videoId,
        jobId: job.id
      });
      throw error;
    }
  }

  /**
   * Get video metadata by ID
   */
  async getVideoMetadata(videoId: string): Promise<VideoMetadata | null> {
    try {
      const response = await this.youtube.videos.list({
        part: ['snippet', 'statistics', 'contentDetails'],
        id: [videoId],
      });

      const item = response.data.items?.[0];
      if (!item) {
        return null;
      }

      return {
        videoId: item.id!,
        channelId: item.snippet?.channelId || '',
        title: item.snippet?.title || 'Unknown',
        description: item.snippet?.description || '',
        publishedAt: item.snippet?.publishedAt || new Date().toISOString(),
        thumbnailUrl: item.snippet?.thumbnails?.maxres?.url || 
                     item.snippet?.thumbnails?.high?.url || 
                     item.snippet?.thumbnails?.medium?.url || '',
        duration: item.contentDetails?.duration || 'PT0S',
        viewCount: parseInt(item.statistics?.viewCount || '0', 10),
        likeCount: parseInt(item.statistics?.likeCount || '0', 10),
        commentCount: parseInt(item.statistics?.commentCount || '0', 10),
      };

    } catch (error) {
      youtubeLogger.videoError(videoId, 'Error fetching video metadata', error as Error);
      throw error;
    }
  }

  /**
   * Manually trigger processing for a specific video
   */
  async processVideoManually(videoId: string): Promise<void> {
    try {
      const video = await this.getVideoMetadata(videoId);
      if (!video) {
        throw new Error(`Video ${videoId} not found`);
      }

      await this.processNewVideo(video);

    } catch (error) {
      youtubeLogger.videoError(videoId, 'Error in manual video processing', error as Error);
      throw error;
    }
  }

  /**
   * Stop monitoring
   */
  async stopMonitoring(): Promise<void> {
    youtubeLogger.info('Stopping YouTube monitoring');
    
    // Stop cron job
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }

    // Disable push notifications
    if (this.pushNotificationsEnabled) {
      await this.disablePushNotifications();
    }

    youtubeLogger.info('YouTube monitoring stopped');
  }

  /**
   * Get monitoring status
   */
  getMonitoringStatus(): {
    isActive: boolean;
    pushNotificationsEnabled: boolean;
    channelId: string;
    lastCheck?: string;
  } {
    return {
      isActive: this.cronJob !== null || this.pushNotificationsEnabled,
      pushNotificationsEnabled: this.pushNotificationsEnabled,
      channelId: config.youtube.channelId,
      lastCheck: this.lastVideoCheckTime.get(config.youtube.channelId)
    };
  }
} 