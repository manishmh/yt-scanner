import { ThumbnailAnalyzer } from '@/services/analysis/thumbnail';
import { VideoAnalysisResult, VideoMetadata } from '@/types';
import { videoLogger } from '@/utils/logger';

export class SimpleVideoProcessor {
  private thumbnailAnalyzer: ThumbnailAnalyzer;

  constructor() {
    this.thumbnailAnalyzer = new ThumbnailAnalyzer();
  }

  /**
   * Process a video with simplified analysis (no Redis dependencies)
   */
  async processVideo(video: VideoMetadata): Promise<VideoAnalysisResult> {
    const startTime = Date.now();
    
    try {
      videoLogger.videoInfo(video.videoId, 'Starting simplified video processing', {
        title: video.title,
        thumbnailUrl: video.thumbnailUrl
      });

      // 1. Thumbnail Analysis
      const thumbnailAnalysis = await this.analyzeThumbnail(video);
      
      // 2. Simplified Video Analysis (mock for now)
      const videoAnalysis = {
        giftCodes: [],
        laughterEvents: [],
        behaviorEvents: [],
        frameAnalysis: []
      };

      // 3. Simplified Transcript Analysis (mock for now)
      const transcriptAnalysis = {
        segments: [],
        keywords: [],
        suspiciousSegments: []
      };

      // 4. Simplified Audio Analysis (mock for now)
      const audioAnalysis = {
        laughterPeaks: [],
        suspiciousAudioSegments: []
      };

      // 5. Generate Summary
      const summary = this.generateSummary(thumbnailAnalysis, videoAnalysis, transcriptAnalysis, audioAnalysis);

      const processingDuration = Date.now() - startTime;

      const result: VideoAnalysisResult = {
        videoId: video.videoId,
        processedAt: new Date().toISOString(),
        processingDuration,
        thumbnailAnalysis,
        videoAnalysis,
        transcriptAnalysis,
        audioAnalysis,
        summary
      };

      videoLogger.videoInfo(video.videoId, 'Video processing completed', {
        processingDuration,
        confidenceScore: summary.confidenceScore,
        recommendedAction: summary.recommendedAction
      });

      return result;

    } catch (error) {
      videoLogger.videoError(video.videoId, 'Error in video processing', error as Error);
      throw error;
    }
  }

  /**
   * Analyze thumbnail for monetary content
   */
  private async analyzeThumbnail(video: VideoMetadata) {
    try {
      if (!video.thumbnailUrl) {
        return {
          monetaryDetections: [],
          hasMoneyThumbnail: false
        };
      }

      const analysis = await this.thumbnailAnalyzer.analyzeThumbnail(video.thumbnailUrl, video.videoId);
      
      return {
        monetaryDetections: analysis.monetaryDetections,
        hasMoneyThumbnail: analysis.monetaryDetections.length > 0
      };

    } catch (error) {
      videoLogger.videoError(video.videoId, 'Error analyzing thumbnail', error as Error);
      return {
        monetaryDetections: [],
        hasMoneyThumbnail: false
      };
    }
  }

  /**
   * Generate analysis summary
   */
  private generateSummary(thumbnailAnalysis: any, videoAnalysis: any, transcriptAnalysis: any, audioAnalysis: any) {
    const codesFound = videoAnalysis.giftCodes.length;
    const laughterEvents = videoAnalysis.laughterEvents.length + audioAnalysis.laughterPeaks.length;
    const suspiciousKeywords = transcriptAnalysis.suspiciousSegments.length;
    const hasMoneyThumbnail = thumbnailAnalysis.hasMoneyThumbnail;

    // Calculate confidence score
    let confidenceScore = 0;
    if (hasMoneyThumbnail) confidenceScore += 0.3;
    if (codesFound > 0) confidenceScore += 0.4;
    if (laughterEvents > 0) confidenceScore += 0.2;
    if (suspiciousKeywords > 0) confidenceScore += 0.1;

    // Determine recommended action
    let recommendedAction: 'investigate' | 'monitor' | 'ignore' = 'ignore';
    if (confidenceScore > 0.7) {
      recommendedAction = 'investigate';
    } else if (confidenceScore > 0.3 || hasMoneyThumbnail) {
      recommendedAction = 'monitor';
    }

    return {
      codesFound,
      laughterEvents,
      suspiciousKeywords,
      confidenceScore: Math.round(confidenceScore * 100) / 100,
      recommendedAction
    };
  }
} 