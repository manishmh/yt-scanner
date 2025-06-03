import {
    ProcessingJob,
    VideoAnalysisResult,
    VideoMetadata
} from '@/types';
import { FirestoreService } from './firestore';

export class DatabaseService {
  private firestoreService: FirestoreService;

  constructor() {
    this.firestoreService = new FirestoreService();
    this.initialize();
  }

  /**
   * Initialize the database
   */
  private async initialize(): Promise<void> {
    try {
      await this.firestoreService.initializeCollections();
    } catch (error) {
      console.error('Failed to initialize Firestore database:', error);
      throw error;
    }
  }

  /**
   * Save video analysis result
   */
  async saveResult(result: VideoAnalysisResult): Promise<void> {
    return this.firestoreService.saveResult(result);
  }

  /**
   * Get analysis result by video ID
   */
  async getResult(videoId: string): Promise<VideoAnalysisResult | null> {
    return this.firestoreService.getResult(videoId);
  }

  /**
   * Get recent analysis results
   */
  async getRecentResults(limit: number = 10): Promise<VideoAnalysisResult[]> {
    return this.firestoreService.getRecentResults(limit);
  }

  /**
   * Save video metadata
   */
  async saveVideoMetadata(metadata: VideoMetadata): Promise<void> {
    return this.firestoreService.saveVideoMetadata(metadata);
  }

  /**
   * Create a processing job
   */
  async createJob(job: ProcessingJob): Promise<void> {
    return this.firestoreService.createJob(job);
  }

  /**
   * Update a processing job
   */
  async updateJob(jobId: string, updates: Partial<ProcessingJob>): Promise<void> {
    return this.firestoreService.updateJob(jobId, updates);
  }

  /**
   * Get database statistics
   */
  async getStatistics(): Promise<{
    totalVideosProcessed: number;
    recentAnalyses: number;
    averageProcessingTime: number;
    highConfidenceDetections: number;
  }> {
    return this.firestoreService.getStatistics();
  }

  /**
   * Get multiple analysis results with filtering and pagination
   */
  async getResults(options: {
    recommendedAction?: 'investigate' | 'monitor' | 'ignore';
    hasMoneyThumbnail?: boolean;
    codesFound?: { min?: number; max?: number };
    limit?: number;
    skip?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<{
    results: VideoAnalysisResult[];
    total: number;
  }> {
    // For now, return recent results with basic filtering
    const limit = options.limit || 10;
    const results = await this.firestoreService.getRecentResults(limit);
    
    // Apply basic filtering if needed
    let filteredResults = results;
    if (options.recommendedAction) {
      filteredResults = results.filter(r => 
        r.summary.recommendedAction === options.recommendedAction
      );
    }
    
    return {
      results: filteredResults,
      total: filteredResults.length
    };
  }

  /**
   * Get processing jobs with filtering
   */
  async getJobs(_options: {
    status?: ProcessingJob['status'];
    videoId?: string;
    type?: ProcessingJob['type'];
    priority?: ProcessingJob['priority'];
    limit?: number;
    skip?: number;
  } = {}): Promise<{
    jobs: ProcessingJob[];
    total: number;
  }> {
    // For Firestore, we'll implement basic job retrieval
    // This would need to be implemented in the Firestore service for full filtering
    return {
      jobs: [],
      total: 0
    };
  }

  /**
   * Clean up old records with options
   */
  async cleanup(options: {
    olderThanDays?: number;
    keepInvestigateResults?: boolean;
  } | number = 30): Promise<{
    deletedJobs: number;
    deletedResults: number;
  }> {
    let olderThanDays = 30;
    
    if (typeof options === 'number') {
      olderThanDays = options;
    } else {
      olderThanDays = options.olderThanDays || 30;
    }
    
    await this.firestoreService.cleanup(olderThanDays);
    
    return {
      deletedJobs: 0, // Firestore service doesn't return counts yet
      deletedResults: 0
    };
  }

  /**
   * Disconnect from database (no-op for Firestore)
   */
  async disconnect(): Promise<void> {
    // Firestore doesn't require explicit disconnection
    return Promise.resolve();
  }

  /**
   * Check if database is connected (always true for Firestore)
   */
  isConnectedToDatabase(): boolean {
    return true;
  }
} 