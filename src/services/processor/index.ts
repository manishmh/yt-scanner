import { config } from '@/config';
import {
    ProcessingJob,
    VideoAnalysisResult,
    VideoMetadata
} from '@/types';
import { pubsubLogger } from '@/utils/logger';
import { Message, PubSub } from '@google-cloud/pubsub';
import { AudioAnalyzer } from '../analysis/audio';
import { ThumbnailAnalyzer } from '../analysis/thumbnail';
import { TranscriptAnalyzer } from '../analysis/transcript';
import { VideoAnalyzer } from '../analysis/video';
import { DatabaseService } from '../database';
import { CloudTasksService } from '../queue/cloud-tasks';
import { ProcessCoordinator } from './coordinator';

export class VideoProcessor {
  private pubsub: PubSub;
  private subscription: any;
  private thumbnailAnalyzer: ThumbnailAnalyzer;
  private videoAnalyzer: VideoAnalyzer;
  private transcriptAnalyzer: TranscriptAnalyzer;
  private audioAnalyzer: AudioAnalyzer;
  private processCoordinator: ProcessCoordinator;
  private taskQueue: CloudTasksService;
  private database: DatabaseService;

  constructor() {
    this.pubsub = new PubSub({
      projectId: config.googleCloud.projectId,
    });

    this.thumbnailAnalyzer = new ThumbnailAnalyzer();
    this.videoAnalyzer = new VideoAnalyzer();
    this.transcriptAnalyzer = new TranscriptAnalyzer();
    this.audioAnalyzer = new AudioAnalyzer();
    this.processCoordinator = new ProcessCoordinator();
    this.database = new DatabaseService();
    this.taskQueue = new CloudTasksService();

    this.initializeTaskQueue();
    
    pubsubLogger.info('Video Processor initialized', {
      subscription: config.pubsub.subscriptionVideoProcessor,
      taskQueueEnabled: !!this.taskQueue,
      coordinatedAnalysisEnabled: !!this.processCoordinator
    });
  }

  /**
   * Start processing videos from Pub/Sub
   */
  async startProcessing(): Promise<void> {
    try {
      this.subscription = this.pubsub.subscription(config.pubsub.subscriptionVideoProcessor);
      
      // Handle incoming messages
      this.subscription.on('message', this.handleMessage.bind(this));
      this.subscription.on('error', this.handleError.bind(this));

      pubsubLogger.info('Started listening for video processing messages');

    } catch (error) {
      pubsubLogger.error('Failed to start processing', error as Error);
      throw error;
    }
  }

  /**
   * Handle incoming Pub/Sub message
   */
  private async handleMessage(message: Message): Promise<void> {
    try {
      const data = JSON.parse(message.data.toString());
      const { video, job } = data as { video: VideoMetadata; job: ProcessingJob };

      pubsubLogger.info('Received video processing message', {
        videoId: video.videoId,
        jobId: job.id,
        messageId: message.id
      });

      // Add to processing queue
      await this.taskQueue.addVideoProcessingTask(
        video.videoId,
        { video, job, messageId: message.id },
        job.priority as 'high' | 'medium' | 'low'
      );

      // Acknowledge message
      message.ack();

      pubsubLogger.info('Video queued for processing', {
        videoId: video.videoId,
        jobId: job.id
      });

    } catch (error) {
      pubsubLogger.error('Error handling message', error as Error, {
        messageId: message.id
      });
      
      // Nack the message to retry later
      message.nack();
    }
  }

  /**
   * Handle Pub/Sub errors
   */
  private handleError(error: Error): void {
    pubsubLogger.error('Pub/Sub subscription error', error);
  }

  /**
   * Initialize Cloud Tasks queue
   */
  private async initializeTaskQueue(): Promise<void> {
    try {
      await this.taskQueue.initializeQueue();
      pubsubLogger.info('Cloud Tasks queue initialized successfully');
    } catch (error) {
      pubsubLogger.error('Failed to initialize Cloud Tasks queue', error as Error);
    }
  }

  /**
   * Process a single video through all analysis stages
   */
  async processVideo(video: VideoMetadata, job: ProcessingJob): Promise<VideoAnalysisResult> {
    const startTime = Date.now();
    
    try {
      pubsubLogger.info('Starting video processing', {
        videoId: video.videoId,
        jobId: job.id,
        title: video.title
      });

      // Update job status
      await this.database.updateJob(job.id, { 
        status: 'processing', 
        startedAt: new Date().toISOString() 
      });

      // Stage 1: Thumbnail Analysis (quick filter)
      pubsubLogger.debug('Stage 1: Thumbnail analysis', { videoId: video.videoId });
      const thumbnailAnalysis = await this.thumbnailAnalyzer.analyzeThumbnail(
        video.thumbnailUrl, 
        video.videoId
      );

      // If no monetary values in thumbnail, skip detailed analysis
      if (!thumbnailAnalysis.hasMoneyThumbnail) {
        const result = this.createMinimalResult(video, startTime, thumbnailAnalysis);
        await this.database.saveResult(result);
        await this.database.updateJob(job.id, { 
          status: 'completed', 
          completedAt: new Date().toISOString(),
          result 
        });
        
        pubsubLogger.info('Video processing completed (no monetary thumbnail)', {
          videoId: video.videoId,
          jobId: job.id
        });
        
        return result;
      }

      // Stage 2: Coordinated Gift Code Analysis
      pubsubLogger.debug('Stage 2: Coordinated gift code analysis started', { videoId: video.videoId });
      
      const videoUrl = await this.getVideoUrl(video.videoId);
      
      // Use the ProcessCoordinator for comprehensive multi-process analysis
      const coordinatedResult = await this.processCoordinator.analyzeVideoForGiftCodes(
        video.videoId,
        videoUrl,
        video.thumbnailUrl
      );

      // Stage 3: Compile Results with coordinated analysis
      const result = this.compileCoordinatedResults(
        video,
        startTime,
        thumbnailAnalysis,
        coordinatedResult
      );

      // Stage 4: Save Results
      await this.database.saveResult(result);
      await this.database.updateJob(job.id, { 
        status: 'completed', 
        completedAt: new Date().toISOString(),
        result 
      });

      // Stage 5: Send Notifications (if configured)
      if (result.summary.recommendedAction === 'investigate') {
        await this.sendNotification(result);
      }

      pubsubLogger.info('Video processing completed successfully', {
        videoId: video.videoId,
        jobId: job.id,
        processingDuration: result.processingDuration,
        recommendedAction: result.summary.recommendedAction,
        codesFound: result.summary.codesFound
      });

      return result;

    } catch (error) {
      pubsubLogger.error('Error processing video', error as Error, {
        videoId: video.videoId,
        jobId: job.id
      });

      // Update job with error
      await this.database.updateJob(job.id, { 
        status: 'failed', 
        completedAt: new Date().toISOString(),
        error: (error as Error).message 
      });

      throw error;
    }
  }

  /**
   * Create minimal result for videos without monetary thumbnails
   */
  private createMinimalResult(
    video: VideoMetadata, 
    startTime: number,
    thumbnailAnalysis: any
  ): VideoAnalysisResult {
    return {
      videoId: video.videoId,
      processedAt: new Date().toISOString(),
      processingDuration: Date.now() - startTime,
      thumbnailAnalysis,
      videoAnalysis: {
        giftCodes: [],
        laughterEvents: [],
        behaviorEvents: [],
        frameAnalysis: []
      },
      transcriptAnalysis: {
        segments: [],
        keywords: [],
        suspiciousSegments: []
      },
      audioAnalysis: {
        laughterPeaks: [],
        suspiciousAudioSegments: []
      },
      summary: {
        codesFound: 0,
        laughterEvents: 0,
        suspiciousKeywords: 0,
        confidenceScore: 0,
        recommendedAction: 'ignore'
      }
    };
  }

  /**
   * Compile coordinated analysis results into final result
   */
  private compileCoordinatedResults(
    video: VideoMetadata,
    startTime: number,
    thumbnailAnalysis: any,
    coordinatedResult: VideoAnalysisResult
  ): VideoAnalysisResult {
    const processingDuration = Date.now() - startTime;

    const result: VideoAnalysisResult = {
      videoId: video.videoId,
      processedAt: new Date().toISOString(),
      processingDuration,
      thumbnailAnalysis: {
        monetaryDetections: thumbnailAnalysis.monetaryDetections,
        hasMoneyThumbnail: thumbnailAnalysis.hasMoneyThumbnail
      },
      giftCodes: coordinatedResult.giftCodes || [],
      laughterEvents: coordinatedResult.laughterEvents || [],
      behaviorEvents: coordinatedResult.behaviorEvents || [],
      frameAnalysis: coordinatedResult.frameAnalysis || [],
      transcriptAnalysis: coordinatedResult.transcriptAnalysis,
      audioAnalysis: coordinatedResult.audioAnalysis,
      summary: coordinatedResult.summary
    };

    pubsubLogger.info('Coordinated analysis results compiled', {
      videoId: video.videoId,
      processingDuration,
      giftCodesFound: result.giftCodes?.length || 0,
      laughterEvents: result.laughterEvents?.length || 0,
      recommendedAction: result.summary.recommendedAction
    });

    return result;
  }

  /**
   * Compile all analysis results into final result (legacy method)
   */
  private compileResults(
    video: VideoMetadata,
    startTime: number,
    thumbnailAnalysis: any,
    videoAnalysis: any,
    transcriptAnalysis: any,
    audioAnalysis: any
  ): VideoAnalysisResult {
    const codesFound = videoAnalysis.giftCodes.length;
    const laughterEvents = videoAnalysis.laughterEvents.length + audioAnalysis.laughterPeaks.length;
    const suspiciousKeywords = transcriptAnalysis.suspiciousSegments.length;

    // Calculate confidence score
    const confidenceScore = this.calculateConfidenceScore({
      codesFound,
      laughterEvents,
      suspiciousKeywords,
      thumbnailHasMoney: thumbnailAnalysis.hasMoneyThumbnail
    });

    // Determine recommended action
    const recommendedAction = this.determineRecommendedAction({
      codesFound,
      laughterEvents,
      suspiciousKeywords,
      confidenceScore
    });

    return {
      videoId: video.videoId,
      processedAt: new Date().toISOString(),
      processingDuration: Date.now() - startTime,
      thumbnailAnalysis,
      videoAnalysis,
      transcriptAnalysis,
      audioAnalysis,
      summary: {
        codesFound,
        laughterEvents,
        suspiciousKeywords,
        confidenceScore,
        recommendedAction
      }
    };
  }

  /**
   * Calculate overall confidence score
   */
  private calculateConfidenceScore(metrics: {
    codesFound: number;
    laughterEvents: number;
    suspiciousKeywords: number;
    thumbnailHasMoney: boolean;
  }): number {
    let score = 0;

    // Weight different factors
    if (metrics.thumbnailHasMoney) score += 0.3;
    if (metrics.codesFound > 0) score += 0.4;
    if (metrics.laughterEvents > 0) score += 0.2;
    if (metrics.suspiciousKeywords > 0) score += 0.1;

    // Bonus for multiple indicators
    const indicators = [
      metrics.thumbnailHasMoney,
      metrics.codesFound > 0,
      metrics.laughterEvents > 0,
      metrics.suspiciousKeywords > 0
    ].filter(Boolean).length;

    if (indicators >= 3) score += 0.2;
    else if (indicators >= 2) score += 0.1;

    return Math.min(score, 1.0);
  }

  /**
   * Determine recommended action based on analysis
   */
  private determineRecommendedAction(metrics: {
    codesFound: number;
    laughterEvents: number;
    suspiciousKeywords: number;
    confidenceScore: number;
  }): 'investigate' | 'monitor' | 'ignore' {
    if (metrics.codesFound > 0 && metrics.confidenceScore > 0.7) {
      return 'investigate';
    }
    
    if (metrics.confidenceScore > 0.5) {
      return 'monitor';
    }
    
    return 'ignore';
  }

  /**
   * Get video URL (placeholder - would integrate with youtube-dl or similar)
   */
  private async getVideoUrl(videoId: string): Promise<string> {
    // In a real implementation, you'd use youtube-dl or similar to get the direct video URL
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  /**
   * Send notification for high-priority findings
   */
  private async sendNotification(result: VideoAnalysisResult): Promise<void> {
    if (!config.webhook.url) {
      return;
    }

    try {
      // Send webhook notification (implement based on your needs)
      pubsubLogger.info('Notification sent', {
        videoId: result.videoId,
        action: result.summary.recommendedAction,
        codesFound: result.summary.codesFound,
        timestamp: result.processedAt,
        confidence: result.summary.confidenceScore
      });

    } catch (error) {
      pubsubLogger.error('Failed to send notification', error as Error, {
        videoId: result.videoId
      });
    }
  }



  /**
   * Stop processing
   */
  async stopProcessing(): Promise<void> {
    try {
      if (this.subscription) {
        await this.subscription.close();
      }
      
      // Cloud Tasks doesn't need explicit closing
      
      pubsubLogger.info('Video processor stopped');

    } catch (error) {
      pubsubLogger.error('Error stopping processor', error as Error);
      throw error;
    }
  }

  /**
   * Get processing status
   */
  async getStatus(): Promise<{
    queueStats: any;
    subscription: string;
    isProcessing: boolean;
  }> {
    const stats = await this.taskQueue.getQueueStats();

    return {
      queueStats: {
        waiting: stats.tasksCount,
        active: 0, // Cloud Tasks doesn't expose this directly
        completed: 0, // Would need to be tracked separately
        failed: 0 // Would need to be tracked separately
      },
      subscription: config.pubsub.subscriptionVideoProcessor,
      isProcessing: stats.tasksCount > 0
    };
  }
} 