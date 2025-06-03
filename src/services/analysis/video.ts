import { config } from '@/config';
import {
    BehaviorDetection,
    FrameAnalysisResult,
    GiftCodeDetection,
    LaughterDetection
} from '@/types';
import { videoLogger } from '@/utils/logger';
import ffmpegStatic from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { FirestoreService } from '../database/firestore';
import { GiftCodeDetectionService } from './giftcode';
import { ThumbnailAnalyzer } from './thumbnail';

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic!);

export class VideoAnalyzer {
  private thumbnailAnalyzer: ThumbnailAnalyzer;
  private giftCodeService: GiftCodeDetectionService;
  private storageService: FirestoreService;

  constructor() {
    this.thumbnailAnalyzer = new ThumbnailAnalyzer();
    this.giftCodeService = new GiftCodeDetectionService();
    this.storageService = new FirestoreService();
    
    videoLogger.info('Video Analyzer initialized', {
      frameSamplingInterval: config.videoProcessing.frameSamplingIntervalSeconds,
      maxDuration: config.videoProcessing.maxDurationMinutes,
      storageEnabled: !!this.storageService
    });
  }

  /**
   * Analyze video for gift codes, laughter, and behavioral cues
   */
  async analyzeVideo(videoUrl: string, videoId: string): Promise<{
    giftCodes: GiftCodeDetection[];
    laughterEvents: LaughterDetection[];
    behaviorEvents: BehaviorDetection[];
    frameAnalysis: FrameAnalysisResult[];
  }> {
    const startTime = Date.now();

    try {
      videoLogger.videoInfo(videoId, 'Starting video analysis', { videoUrl });

      // Download video to temporary location
      const localVideoPath = await this.downloadVideo(videoUrl, videoId);
      
      // Analyze frames for gift codes
      const frameAnalysis = await this.analyzeFrames(localVideoPath, videoId);
      
      // Extract gift codes from frame analysis
      const giftCodes = await this.extractGiftCodesFromFrames(frameAnalysis, videoId);

      // Cleanup
      if (fs.existsSync(localVideoPath)) {
        fs.unlinkSync(localVideoPath);
      }

      const duration = Date.now() - startTime;
      videoLogger.performance('video-analysis', duration, {
        videoId,
        framesAnalyzed: frameAnalysis.length,
        giftCodesFound: giftCodes.length
      });

      return {
        giftCodes,
        laughterEvents: [],
        behaviorEvents: [],
        frameAnalysis
      };

    } catch (error) {
      videoLogger.videoError(videoId, 'Error analyzing video', error as Error, { videoUrl });
      throw error;
    }
  }

  /**
   * Analyze specific video segment for gift codes (targeted analysis)
   */
  async analyzeVideoSegment(
    videoUrl: string,
    videoId: string,
    startTime: number,
    endTime: number
  ): Promise<{
    giftCodes: GiftCodeDetection[];
    frameAnalysis: FrameAnalysisResult[];
  }> {
    try {
      videoLogger.debug('Starting targeted video segment analysis', {
        videoId,
        startTime,
        endTime,
        duration: endTime - startTime
      });

      // Download video segment to temporary location
      const localVideoPath = await this.downloadVideoSegment(videoUrl, videoId, startTime, endTime);
      
      // Analyze frames in the segment with higher frequency
      const frameAnalysis = await this.analyzeFramesInSegment(localVideoPath, videoId, startTime, endTime);
      
      // Extract gift codes from frame analysis
      const giftCodes = await this.extractGiftCodesFromFrames(frameAnalysis, videoId);

      // Cleanup
      if (fs.existsSync(localVideoPath)) {
        fs.unlinkSync(localVideoPath);
      }

      videoLogger.debug('Targeted video segment analysis completed', {
        videoId,
        startTime,
        endTime,
        framesAnalyzed: frameAnalysis.length,
        giftCodesFound: giftCodes.length
      });

      return {
        giftCodes,
        frameAnalysis
      };

    } catch (error) {
      videoLogger.error('Error analyzing video segment', error as Error, {
        videoId,
        startTime,
        endTime
      });
      throw error;
    }
  }

  /**
   * Download video from URL
   */
  private async downloadVideo(videoUrl: string, videoId: string): Promise<string> {
    const tempDir = path.join(process.cwd(), 'temp');
    const tempPath = path.join(tempDir, `${videoId}.mp4`);

    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      videoLogger.debug('Downloading video', { videoId, videoUrl });

      ffmpeg(videoUrl)
        .output(tempPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .duration(config.videoProcessing.maxDurationMinutes * 60) // Limit duration
        .on('end', () => {
          videoLogger.debug('Video download completed', { videoId, tempPath });
          resolve(tempPath);
        })
        .on('error', (error) => {
          videoLogger.videoError(videoId, 'Error downloading video', error, { videoUrl });
          reject(error);
        })
        .run();
    });
  }

  /**
   * Analyze individual frames for OCR
   */
  private async analyzeFrames(videoPath: string, videoId: string): Promise<FrameAnalysisResult[]> {
    try {
      videoLogger.debug('Starting frame analysis', { videoId });

      const frameResults: FrameAnalysisResult[] = [];
      const framePaths = await this.extractFrames(videoPath, videoId);

      // Analyze frames in batches
      const batchSize = 5;
      for (let i = 0; i < framePaths.length; i += batchSize) {
        const batch = framePaths.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (framePath, index) => {
          const frameNumber = i + index;
          const timestamp = frameNumber * config.videoProcessing.frameSamplingIntervalSeconds;

          try {
            // Use thumbnail analyzer for frame OCR
            const frameBuffer = fs.readFileSync(framePath);
            const mockUrl = `data:image/png;base64,${frameBuffer.toString('base64')}`;
            
            const result = await this.thumbnailAnalyzer.analyzeThumbnail(mockUrl, videoId);
            
            const frameResult: FrameAnalysisResult = {
              frameNumber,
              timestamp,
              ocrResults: result.monetaryDetections.map(d => ({
                text: `$${d.amount}`,
                confidence: d.confidence,
                boundingBox: d.boundingBox,
                monetaryValues: [d]
              })),
              objects: [],
              faces: []
            };

            return frameResult;

          } catch (error) {
            videoLogger.debug('Error analyzing frame', { videoId, frameNumber, error });
            return null;
          } finally {
            // Cleanup frame file
            if (fs.existsSync(framePath)) {
              fs.unlinkSync(framePath);
            }
          }
        });

        const batchResults = await Promise.all(batchPromises);
        frameResults.push(...batchResults.filter(r => r !== null) as FrameAnalysisResult[]);
      }

      videoLogger.debug('Frame analysis completed', {
        videoId,
        framesAnalyzed: frameResults.length
      });

      return frameResults;

    } catch (error) {
      videoLogger.videoError(videoId, 'Error analyzing frames', error as Error);
      return [];
    }
  }

  /**
   * Extract frames from video at specified intervals
   */
  private extractFrames(videoPath: string, videoId: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const tempDir = path.join(process.cwd(), 'temp', 'frames', videoId);
      
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const framePaths: string[] = [];
      const interval = config.videoProcessing.frameSamplingIntervalSeconds;

      ffmpeg(videoPath)
        .outputOptions([
          '-vf', `fps=1/${interval}`,
          '-f', 'image2',
          '-q:v', '2'
        ])
        .output(path.join(tempDir, 'frame_%04d.png'))
        .on('end', () => {
          // Collect frame paths
          const files = fs.readdirSync(tempDir);
          for (const file of files) {
            if (file.endsWith('.png')) {
              framePaths.push(path.join(tempDir, file));
            }
          }
          resolve(framePaths);
        })
        .on('error', reject)
        .run();
    });
  }

  /**
   * Download specific video segment
   */
  private async downloadVideoSegment(
    videoUrl: string,
    videoId: string,
    startTime: number,
    endTime: number
  ): Promise<string> {
    const tempDir = path.join(process.cwd(), 'temp', 'segments');
    const tempPath = path.join(tempDir, `${videoId}_${startTime}_${endTime}.mp4`);

    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      videoLogger.debug('Downloading video segment', {
        videoId,
        startTime,
        endTime,
        duration: endTime - startTime
      });

      ffmpeg(videoUrl)
        .output(tempPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .seekInput(startTime) // Start from specific time
        .duration(endTime - startTime) // Duration of segment
        .on('end', () => {
          videoLogger.debug('Video segment download completed', {
            videoId,
            tempPath,
            startTime,
            endTime
          });
          resolve(tempPath);
        })
        .on('error', (error) => {
          videoLogger.error('Error downloading video segment', error, {
            videoId,
            startTime,
            endTime
          });
          reject(error);
        })
        .run();
    });
  }

  /**
   * Analyze frames in a specific segment with higher frequency
   */
  private async analyzeFramesInSegment(
    videoPath: string,
    videoId: string,
    segmentStartTime: number,
    segmentEndTime: number
  ): Promise<FrameAnalysisResult[]> {
    try {
      videoLogger.debug('Starting segment frame analysis', {
        videoId,
        segmentStartTime,
        segmentEndTime
      });

      const frameResults: FrameAnalysisResult[] = [];
      // Use higher frequency for targeted analysis (every 0.5 seconds)
      const framePaths = await this.extractFramesFromSegment(videoPath, videoId, 0.5);

      // Analyze frames in batches
      const batchSize = 3; // Smaller batches for faster processing
      for (let i = 0; i < framePaths.length; i += batchSize) {
        const batch = framePaths.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (framePath, index) => {
          const frameNumber = i + index;
          const timestamp = segmentStartTime + (frameNumber * 0.5); // 0.5 second intervals

          try {
            // Use thumbnail analyzer for frame OCR
            const frameBuffer = fs.readFileSync(framePath);
            const mockUrl = `data:image/png;base64,${frameBuffer.toString('base64')}`;
            
            const result = await this.thumbnailAnalyzer.analyzeThumbnail(mockUrl, videoId);
            
            const frameResult: FrameAnalysisResult = {
              frameNumber,
              timestamp,
              ocrResults: result.monetaryDetections.map(d => ({
                text: `$${d.amount}`,
                confidence: d.confidence,
                boundingBox: d.boundingBox,
                monetaryValues: [d]
              })),
              objects: [],
              faces: []
            };

            return frameResult;

          } catch (error) {
            videoLogger.debug('Error analyzing segment frame', {
              videoId,
              frameNumber,
              timestamp,
              error
            });
            return null;
          } finally {
            // Cleanup frame file
            if (fs.existsSync(framePath)) {
              fs.unlinkSync(framePath);
            }
          }
        });

        const batchResults = await Promise.all(batchPromises);
        frameResults.push(...batchResults.filter(r => r !== null) as FrameAnalysisResult[]);
      }

      videoLogger.debug('Segment frame analysis completed', {
        videoId,
        framesAnalyzed: frameResults.length,
        segmentDuration: segmentEndTime - segmentStartTime
      });

      return frameResults;

    } catch (error) {
      videoLogger.error('Error analyzing segment frames', error as Error, {
        videoId,
        segmentStartTime,
        segmentEndTime
      });
      return [];
    }
  }

  /**
   * Extract frames from video segment at higher frequency
   */
  private extractFramesFromSegment(
    videoPath: string,
    videoId: string,
    interval: number = 0.5
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const tempDir = path.join(process.cwd(), 'temp', 'segment-frames', videoId);
      
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const framePaths: string[] = [];

      ffmpeg(videoPath)
        .outputOptions([
          '-vf', `fps=1/${interval}`, // Higher frequency for targeted analysis
          '-f', 'image2',
          '-q:v', '2'
        ])
        .output(path.join(tempDir, 'segment_frame_%04d.png'))
        .on('end', () => {
          // Collect frame paths
          const files = fs.readdirSync(tempDir);
          for (const file of files) {
            if (file.endsWith('.png')) {
              framePaths.push(path.join(tempDir, file));
            }
          }
          resolve(framePaths);
        })
        .on('error', reject)
        .run();
    });
  }

  /**
   * Extract gift codes from frame analysis results
   */
  private async extractGiftCodesFromFrames(
    frameAnalysis: FrameAnalysisResult[],
    videoId: string
  ): Promise<GiftCodeDetection[]> {
    const allGiftCodes: GiftCodeDetection[] = [];

    try {
      for (const frame of frameAnalysis) {
        // Use gift code service to detect codes in OCR results
        const frameCodes = this.giftCodeService.detectGiftCodes(
          frame.ocrResults,
          videoId,
          frame.timestamp
        );
        
        allGiftCodes.push(...frameCodes);
      }

      // Remove duplicates and return
      const uniqueCodes = this.removeDuplicateGiftCodes(allGiftCodes);

      videoLogger.debug('Gift codes extracted from frames', {
        videoId,
        totalFrames: frameAnalysis.length,
        totalDetections: allGiftCodes.length,
        uniqueCodes: uniqueCodes.length
      });

      return uniqueCodes;

    } catch (error) {
      videoLogger.error('Error extracting gift codes from frames', error as Error, {
        videoId,
        frameCount: frameAnalysis.length
      });
      return [];
    }
  }

  /**
   * Remove duplicate gift codes based on normalized code
   */
  private removeDuplicateGiftCodes(codes: GiftCodeDetection[]): GiftCodeDetection[] {
    const seen = new Set<string>();
    const unique: GiftCodeDetection[] = [];

    for (const code of codes) {
      if (!seen.has(code.code)) {
        seen.add(code.code);
        unique.push(code);
      }
    }

    return unique;
  }
} 