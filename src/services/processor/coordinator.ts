import { config } from '@/config';
import {
    GiftCodeDetection,
    LaughterDetection,
    ProcessingJob,
    TranscriptSegment,
    VideoAnalysisResult
} from '@/types';
import { videoLogger } from '@/utils/logger';
import { AudioAnalyzer } from '../analysis/audio';
import { GiftCodeDetectionService } from '../analysis/giftcode';
import { TranscriptAnalyzer } from '../analysis/transcript';
import { VideoAnalyzer } from '../analysis/video';
import { CloudTasksService } from '../queue/cloud-tasks';

export interface AnalysisProcess {
  id: string;
  type: 'full-video' | 'audio' | 'transcript' | 'targeted-video';
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  result?: any;
  error?: string;
}

export interface LaughTimestamp {
  timestamp: number;
  confidence: number;
  source: 'audio' | 'transcript';
  context?: string;
}

export class ProcessCoordinator {
  private videoAnalyzer: VideoAnalyzer;
  private audioAnalyzer: AudioAnalyzer;
  private transcriptAnalyzer: TranscriptAnalyzer;
  private giftCodeService: GiftCodeDetectionService;
  private taskQueue: CloudTasksService;
  private activeProcesses: Map<string, AnalysisProcess> = new Map();

  constructor() {
    this.videoAnalyzer = new VideoAnalyzer();
    this.audioAnalyzer = new AudioAnalyzer();
    this.transcriptAnalyzer = new TranscriptAnalyzer();
    this.giftCodeService = new GiftCodeDetectionService();
    this.taskQueue = new CloudTasksService();

    videoLogger.info('Process Coordinator initialized');
  }

  /**
   * Orchestrate comprehensive video analysis for gift codes
   */
  async analyzeVideoForGiftCodes(
    videoId: string,
    videoUrl: string,
    thumbnailUrl: string
  ): Promise<VideoAnalysisResult> {
    const startTime = Date.now();
    
    try {
      videoLogger.videoInfo(videoId, 'Starting coordinated gift code analysis', {
        videoUrl,
        thumbnailUrl
      });

      // Start all independent processes in parallel
      const processes = await this.startParallelAnalysis(videoId, videoUrl);

      // Wait for audio and transcript analysis to complete (they provide timestamps)
      const laughTimestamps = await this.waitForLaughTimestamps(processes, videoId);

      // Start targeted video analysis based on laugh timestamps
      const targetedProcesses = await this.startTargetedAnalysis(
        videoId, 
        videoUrl, 
        laughTimestamps
      );

      // Wait for all processes to complete
      const allProcesses = [...processes, ...targetedProcesses];
      await this.waitForAllProcesses(allProcesses, videoId);

      // Aggregate results
      const result = await this.aggregateResults(allProcesses, videoId, startTime);

      videoLogger.videoInfo(videoId, 'Coordinated analysis completed', {
        duration: Date.now() - startTime,
        processesRun: allProcesses.length,
        giftCodesFound: result.giftCodes?.length || 0
      });

      return result;

    } catch (error) {
      videoLogger.videoError(videoId, 'Error in coordinated analysis', error as Error);
      throw error;
    }
  }

  /**
   * Start parallel independent analysis processes
   */
  private async startParallelAnalysis(
    videoId: string, 
    videoUrl: string
  ): Promise<AnalysisProcess[]> {
    const processes: AnalysisProcess[] = [];

    // 1. Full video analysis (independent process)
    const fullVideoProcess: AnalysisProcess = {
      id: `full-video-${videoId}-${Date.now()}`,
      type: 'full-video',
      status: 'pending',
      startTime: Date.now()
    };

    // 2. Audio analysis (for laugh detection)
    const audioProcess: AnalysisProcess = {
      id: `audio-${videoId}-${Date.now()}`,
      type: 'audio',
      status: 'pending',
      startTime: Date.now()
    };

    // 3. Transcript analysis (for laugh keywords)
    const transcriptProcess: AnalysisProcess = {
      id: `transcript-${videoId}-${Date.now()}`,
      type: 'transcript',
      status: 'pending',
      startTime: Date.now()
    };

    processes.push(fullVideoProcess, audioProcess, transcriptProcess);

    // Start all processes
    await Promise.all([
      this.runFullVideoAnalysis(fullVideoProcess, videoId, videoUrl),
      this.runAudioAnalysis(audioProcess, videoId, videoUrl),
      this.runTranscriptAnalysis(transcriptProcess, videoId)
    ]);

    return processes;
  }

  /**
   * Run full video analysis process
   */
  private async runFullVideoAnalysis(
    process: AnalysisProcess,
    videoId: string,
    videoUrl: string
  ): Promise<void> {
    try {
      process.status = 'running';
      this.activeProcesses.set(process.id, process);

      videoLogger.debug('Starting full video analysis process', {
        processId: process.id,
        videoId
      });

      const result = await this.videoAnalyzer.analyzeVideo(videoUrl, videoId);
      
      // Extract gift codes from frame analysis
      const giftCodes: GiftCodeDetection[] = [];
      for (const frame of result.frameAnalysis) {
        const frameCodes = this.giftCodeService.detectGiftCodes(
          frame.ocrResults,
          videoId,
          frame.timestamp
        );
        giftCodes.push(...frameCodes);
      }

      process.result = { giftCodes, frameAnalysis: result.frameAnalysis };
      process.status = 'completed';
      process.endTime = Date.now();

      videoLogger.debug('Full video analysis completed', {
        processId: process.id,
        videoId,
        giftCodesFound: giftCodes.length,
        framesAnalyzed: result.frameAnalysis.length
      });

    } catch (error) {
      process.status = 'failed';
      process.error = (error as Error).message;
      process.endTime = Date.now();

      videoLogger.error('Full video analysis failed', error as Error, {
        processId: process.id,
        videoId
      });
    }
  }

  /**
   * Run audio analysis process
   */
  private async runAudioAnalysis(
    process: AnalysisProcess,
    videoId: string,
    videoUrl: string
  ): Promise<void> {
    try {
      process.status = 'running';
      this.activeProcesses.set(process.id, process);

      videoLogger.debug('Starting audio analysis process', {
        processId: process.id,
        videoId
      });

      const result = await this.audioAnalyzer.analyzeAudio(videoUrl, videoId);
      
      process.result = { 
        laughterPeaks: result.laughterPeaks,
        suspiciousSegments: result.suspiciousAudioSegments
      };
      process.status = 'completed';
      process.endTime = Date.now();

      videoLogger.debug('Audio analysis completed', {
        processId: process.id,
        videoId,
        laughterPeaks: result.laughterPeaks.length
      });

    } catch (error) {
      process.status = 'failed';
      process.error = (error as Error).message;
      process.endTime = Date.now();

      videoLogger.error('Audio analysis failed', error as Error, {
        processId: process.id,
        videoId
      });
    }
  }

  /**
   * Run transcript analysis process
   */
  private async runTranscriptAnalysis(
    process: AnalysisProcess,
    videoId: string
  ): Promise<void> {
    try {
      process.status = 'running';
      this.activeProcesses.set(process.id, process);

      videoLogger.debug('Starting transcript analysis process', {
        processId: process.id,
        videoId
      });

      const result = await this.transcriptAnalyzer.analyzeTranscript(videoId);
      
      // Find laugh-related segments
      const laughSegments = this.findLaughSegments(result.segments);
      
      process.result = { 
        segments: result.segments,
        laughSegments,
        keywords: result.keywords
      };
      process.status = 'completed';
      process.endTime = Date.now();

      videoLogger.debug('Transcript analysis completed', {
        processId: process.id,
        videoId,
        totalSegments: result.segments.length,
        laughSegments: laughSegments.length
      });

    } catch (error) {
      process.status = 'failed';
      process.error = (error as Error).message;
      process.endTime = Date.now();

      videoLogger.error('Transcript analysis failed', error as Error, {
        processId: process.id,
        videoId
      });
    }
  }

  /**
   * Wait for laugh timestamps from audio and transcript analysis
   */
  private async waitForLaughTimestamps(
    processes: AnalysisProcess[],
    videoId: string
  ): Promise<LaughTimestamp[]> {
    const laughTimestamps: LaughTimestamp[] = [];
    const maxWaitTime = 5 * 60 * 1000; // 5 minutes
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const audioProcess = processes.find(p => p.type === 'audio');
      const transcriptProcess = processes.find(p => p.type === 'transcript');

      // Check if both processes are completed
      if (audioProcess?.status === 'completed' && transcriptProcess?.status === 'completed') {
        // Extract laugh timestamps from audio
        if (audioProcess.result?.laughterPeaks) {
          for (const laugh of audioProcess.result.laughterPeaks as LaughterDetection[]) {
            laughTimestamps.push({
              timestamp: laugh.startTime,
              confidence: laugh.confidence,
              source: 'audio',
              context: `${laugh.type} laugh (intensity: ${laugh.intensity})`
            });
          }
        }

        // Extract laugh timestamps from transcript
        if (transcriptProcess.result?.laughSegments) {
          for (const segment of transcriptProcess.result.laughSegments as TranscriptSegment[]) {
            laughTimestamps.push({
              timestamp: segment.startTime,
              confidence: segment.confidence,
              source: 'transcript',
              context: segment.text.substring(0, 100)
            });
          }
        }

        break;
      }

      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    videoLogger.debug('Laugh timestamps collected', {
      videoId,
      totalTimestamps: laughTimestamps.length,
      audioTimestamps: laughTimestamps.filter(t => t.source === 'audio').length,
      transcriptTimestamps: laughTimestamps.filter(t => t.source === 'transcript').length
    });

    return laughTimestamps;
  }

  /**
   * Start targeted video analysis based on laugh timestamps
   */
  private async startTargetedAnalysis(
    videoId: string,
    videoUrl: string,
    laughTimestamps: LaughTimestamp[]
  ): Promise<AnalysisProcess[]> {
    const targetedProcesses: AnalysisProcess[] = [];

    // Create targeted analysis for each laugh timestamp
    for (const laughTimestamp of laughTimestamps) {
      // Analyze 5-60 seconds after the laugh
      const startTime = laughTimestamp.timestamp + 5; // 5 seconds after laugh
      const endTime = laughTimestamp.timestamp + 60; // Up to 60 seconds after laugh

      const targetedProcess: AnalysisProcess = {
        id: `targeted-${videoId}-${laughTimestamp.timestamp}-${Date.now()}`,
        type: 'targeted-video',
        status: 'pending',
        startTime: Date.now()
      };

      targetedProcesses.push(targetedProcess);

      // Start targeted analysis
      this.runTargetedVideoAnalysis(
        targetedProcess,
        videoId,
        videoUrl,
        startTime,
        endTime,
        laughTimestamp
      );
    }

    return targetedProcesses;
  }

  /**
   * Run targeted video analysis for specific time range
   */
  private async runTargetedVideoAnalysis(
    process: AnalysisProcess,
    videoId: string,
    videoUrl: string,
    startTime: number,
    endTime: number,
    laughTimestamp: LaughTimestamp
  ): Promise<void> {
    try {
      process.status = 'running';
      this.activeProcesses.set(process.id, process);

      videoLogger.debug('Starting targeted video analysis', {
        processId: process.id,
        videoId,
        startTime,
        endTime,
        laughSource: laughTimestamp.source
      });

      // This would need to be implemented in VideoAnalyzer
      // For now, we'll simulate targeted analysis
      const result = await this.analyzeVideoSegment(
        videoUrl,
        videoId,
        startTime,
        endTime
      );

      process.result = {
        giftCodes: result.giftCodes,
        timeRange: { startTime, endTime },
        laughTimestamp,
        frameAnalysis: result.frameAnalysis
      };
      process.status = 'completed';
      process.endTime = Date.now();

      videoLogger.debug('Targeted video analysis completed', {
        processId: process.id,
        videoId,
        giftCodesFound: result.giftCodes.length
      });

    } catch (error) {
      process.status = 'failed';
      process.error = (error as Error).message;
      process.endTime = Date.now();

      videoLogger.error('Targeted video analysis failed', error as Error, {
        processId: process.id,
        videoId
      });
    }
  }

  /**
   * Analyze specific video segment for gift codes
   */
  private async analyzeVideoSegment(
    videoUrl: string,
    videoId: string,
    startTime: number,
    endTime: number
  ): Promise<{ giftCodes: GiftCodeDetection[]; frameAnalysis: any[] }> {
    try {
      videoLogger.debug('Analyzing video segment', {
        videoId,
        startTime,
        endTime,
        duration: endTime - startTime
      });

      // Use the enhanced VideoAnalyzer for targeted segment analysis
      const result = await this.videoAnalyzer.analyzeVideoSegment(
        videoUrl,
        videoId,
        startTime,
        endTime
      );

      return {
        giftCodes: result.giftCodes,
        frameAnalysis: result.frameAnalysis
      };

    } catch (error) {
      videoLogger.error('Error analyzing video segment', error as Error, {
        videoId,
        startTime,
        endTime
      });
      return {
        giftCodes: [],
        frameAnalysis: []
      };
    }
  }

  /**
   * Find laugh-related segments in transcript
   */
  private findLaughSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
    const laughKeywords = [
      'laugh', 'laughing', 'lol', 'haha', 'hehe', 'giggle',
      'chuckle', 'funny', 'hilarious', 'joke', 'comedy'
    ];

    return segments.filter(segment => {
      const text = segment.text.toLowerCase();
      return laughKeywords.some(keyword => text.includes(keyword));
    });
  }

  /**
   * Wait for all processes to complete
   */
  private async waitForAllProcesses(
    processes: AnalysisProcess[],
    videoId: string
  ): Promise<void> {
    const maxWaitTime = 10 * 60 * 1000; // 10 minutes
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const pendingProcesses = processes.filter(p => 
        p.status === 'pending' || p.status === 'running'
      );

      if (pendingProcesses.length === 0) {
        break;
      }

      videoLogger.debug('Waiting for processes to complete', {
        videoId,
        pendingProcesses: pendingProcesses.length,
        totalProcesses: processes.length
      });

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    const completedProcesses = processes.filter(p => p.status === 'completed');
    const failedProcesses = processes.filter(p => p.status === 'failed');

    videoLogger.debug('All processes completed', {
      videoId,
      totalProcesses: processes.length,
      completed: completedProcesses.length,
      failed: failedProcesses.length
    });
  }

  /**
   * Aggregate results from all processes
   */
  private async aggregateResults(
    processes: AnalysisProcess[],
    videoId: string,
    startTime: number
  ): Promise<VideoAnalysisResult> {
    const allGiftCodes: GiftCodeDetection[] = [];
    const allLaughterEvents: LaughterDetection[] = [];
    const allFrameAnalysis: any[] = [];

    // Collect results from all processes
    for (const process of processes) {
      if (process.status === 'completed' && process.result) {
        if (process.result.giftCodes) {
          allGiftCodes.push(...process.result.giftCodes);
        }
        if (process.result.laughterPeaks) {
          allLaughterEvents.push(...process.result.laughterPeaks);
        }
        if (process.result.frameAnalysis) {
          allFrameAnalysis.push(...process.result.frameAnalysis);
        }
      }
    }

    // Remove duplicate gift codes
    const uniqueGiftCodes = this.giftCodeService.detectGiftCodes([], videoId)
      .concat(allGiftCodes)
      .filter((code, index, array) => 
        array.findIndex(c => c.code === code.code) === index
      );

    // Determine recommended action
    const recommendedAction = this.determineRecommendedAction(uniqueGiftCodes);

    const result: VideoAnalysisResult = {
      videoId,
      processedAt: new Date().toISOString(),
      processingDuration: Date.now() - startTime,
      giftCodes: uniqueGiftCodes,
      laughterEvents: allLaughterEvents,
      behaviorEvents: [],
      frameAnalysis: allFrameAnalysis,
      summary: {
        recommendedAction,
        confidence: this.calculateOverallConfidence(uniqueGiftCodes),
        keyFindings: this.generateKeyFindings(uniqueGiftCodes, allLaughterEvents)
      }
    };

    return result;
  }

  /**
   * Determine recommended action based on gift codes found
   */
  private determineRecommendedAction(giftCodes: GiftCodeDetection[]): 'monitor' | 'investigate' | 'ignore' {
    if (giftCodes.length === 0) {
      return 'ignore';
    }

    const highConfidenceCodes = giftCodes.filter(code => code.confidence > 0.8);
    if (highConfidenceCodes.length > 0) {
      return 'investigate';
    }

    return 'monitor';
  }

  /**
   * Calculate overall confidence score
   */
  private calculateOverallConfidence(giftCodes: GiftCodeDetection[]): number {
    if (giftCodes.length === 0) return 0;

    const avgConfidence = giftCodes.reduce((sum, code) => sum + code.confidence, 0) / giftCodes.length;
    return Math.round(avgConfidence * 100) / 100;
  }

  /**
   * Generate key findings summary
   */
  private generateKeyFindings(
    giftCodes: GiftCodeDetection[],
    laughterEvents: LaughterDetection[]
  ): string[] {
    const findings: string[] = [];

    if (giftCodes.length > 0) {
      findings.push(`Found ${giftCodes.length} potential Amazon gift code(s)`);
      
      const highConfidenceCodes = giftCodes.filter(code => code.confidence > 0.8);
      if (highConfidenceCodes.length > 0) {
        findings.push(`${highConfidenceCodes.length} high-confidence gift code detection(s)`);
      }
    }

    if (laughterEvents.length > 0) {
      findings.push(`Detected ${laughterEvents.length} laughter event(s)`);
    }

    if (findings.length === 0) {
      findings.push('No significant findings detected');
    }

    return findings;
  }
} 