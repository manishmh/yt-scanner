import { config } from '@/config';
import { ProcessingJob, VideoAnalysisResult, VideoMetadata } from '@/types';
import { videoLogger } from '@/utils/logger';
import { Firestore } from '@google-cloud/firestore';

export class FirestoreService {
  private firestore: Firestore;

  constructor() {
    this.firestore = new Firestore({
      projectId: config.googleCloud.projectId,
    });

    videoLogger.info('Firestore Database Service initialized', {
      projectId: config.googleCloud.projectId
    });
  }

  /**
   * Initialize Firestore collections (no schema needed for NoSQL)
   */
  async initializeCollections(): Promise<void> {
    try {
      // Firestore doesn't require explicit table creation
      // Collections are created automatically when first document is added
      
      // Create indexes for better performance (optional)
      videoLogger.info('Firestore collections ready for use');

    } catch (error) {
      videoLogger.error('Error initializing Firestore collections', error as Error);
      throw error;
    }
  }

  /**
   * Save video analysis result
   */
  async saveResult(result: VideoAnalysisResult): Promise<void> {
    try {
      const docRef = this.firestore.collection('video_analysis_results').doc(result.videoId);
      
      await docRef.set({
        videoId: result.videoId,
        processedAt: result.processedAt,
        processingDuration: result.processingDuration,
        thumbnailAnalysis: result.thumbnailAnalysis,
        videoAnalysis: result.videoAnalysis,
        transcriptAnalysis: result.transcriptAnalysis,
        audioAnalysis: result.audioAnalysis,
        summary: result.summary,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      videoLogger.debug('Analysis result saved to Firestore', { videoId: result.videoId });

    } catch (error) {
      videoLogger.error('Error saving result to Firestore', error as Error, { videoId: result.videoId });
      throw error;
    }
  }

  /**
   * Get analysis result by video ID
   */
  async getResult(videoId: string): Promise<VideoAnalysisResult | null> {
    try {
      const docRef = this.firestore.collection('video_analysis_results').doc(videoId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return null;
      }

      const data = doc.data()!;
      return {
        videoId: data.videoId,
        processedAt: data.processedAt,
        processingDuration: data.processingDuration,
        thumbnailAnalysis: data.thumbnailAnalysis,
        videoAnalysis: data.videoAnalysis,
        transcriptAnalysis: data.transcriptAnalysis,
        audioAnalysis: data.audioAnalysis,
        summary: data.summary
      };

    } catch (error) {
      videoLogger.error('Error getting result from Firestore', error as Error, { videoId });
      throw error;
    }
  }

  /**
   * Get recent analysis results
   */
  async getRecentResults(limit: number = 10): Promise<VideoAnalysisResult[]> {
    try {
      const querySnapshot = await this.firestore
        .collection('video_analysis_results')
        .orderBy('processedAt', 'desc')
        .limit(limit)
        .get();

      const results: VideoAnalysisResult[] = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        results.push({
          videoId: data.videoId,
          processedAt: data.processedAt,
          processingDuration: data.processingDuration,
          thumbnailAnalysis: data.thumbnailAnalysis,
          videoAnalysis: data.videoAnalysis,
          transcriptAnalysis: data.transcriptAnalysis,
          audioAnalysis: data.audioAnalysis,
          summary: data.summary
        });
      });

      return results;

    } catch (error) {
      videoLogger.error('Error getting recent results from Firestore', error as Error);
      throw error;
    }
  }

  /**
   * Save video metadata
   */
  async saveVideoMetadata(metadata: VideoMetadata): Promise<void> {
    try {
      const docRef = this.firestore.collection('video_metadata').doc(metadata.videoId);
      
      await docRef.set({
        videoId: metadata.videoId,
        title: metadata.title,
        description: metadata.description,
        channelId: metadata.channelId,
        channelTitle: metadata.channelTitle,
        publishedAt: metadata.publishedAt,
        duration: metadata.duration,
        thumbnailUrl: metadata.thumbnailUrl,
        viewCount: metadata.viewCount,
        likeCount: metadata.likeCount,
        commentCount: metadata.commentCount,
        tags: metadata.tags,
        categoryId: metadata.categoryId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      videoLogger.debug('Video metadata saved to Firestore', { videoId: metadata.videoId });

    } catch (error) {
      videoLogger.error('Error saving video metadata to Firestore', error as Error, { videoId: metadata.videoId });
      throw error;
    }
  }

  /**
   * Create a processing job
   */
  async createJob(job: ProcessingJob): Promise<void> {
    try {
      const docRef = this.firestore.collection('processing_jobs').doc(job.id);
      
      await docRef.set({
        id: job.id,
        videoId: job.videoId,
        status: job.status,
        priority: job.priority,
        type: job.type,
        createdAt: new Date().toISOString(),
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        error: job.error,
        result: job.result
      });

      videoLogger.debug('Processing job created in Firestore', { jobId: job.id, videoId: job.videoId });

    } catch (error) {
      videoLogger.error('Error creating job in Firestore', error as Error, { jobId: job.id });
      throw error;
    }
  }

  /**
   * Update a processing job
   */
  async updateJob(jobId: string, updates: Partial<ProcessingJob>): Promise<void> {
    try {
      const docRef = this.firestore.collection('processing_jobs').doc(jobId);
      
      await docRef.update({
        ...updates,
        updatedAt: new Date().toISOString()
      });

      videoLogger.debug('Processing job updated in Firestore', { jobId, updates });

    } catch (error) {
      videoLogger.error('Error updating job in Firestore', error as Error, { jobId, updates });
      throw error;
    }
  }

  /**
   * Get statistics
   */
  async getStatistics(): Promise<{
    totalVideosProcessed: number;
    recentAnalyses: number;
    averageProcessingTime: number;
    highConfidenceDetections: number;
  }> {
    try {
      // Get total videos processed
      const totalSnapshot = await this.firestore.collection('video_analysis_results').get();
      const totalVideosProcessed = totalSnapshot.size;

      // Get recent analyses (last 24 hours)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const recentSnapshot = await this.firestore
        .collection('video_analysis_results')
        .where('processedAt', '>', oneDayAgo)
        .get();
      const recentAnalyses = recentSnapshot.size;

      // Calculate average processing time
      let totalProcessingTime = 0;
      let processingTimeCount = 0;
      
      totalSnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.processingDuration) {
          totalProcessingTime += data.processingDuration;
          processingTimeCount++;
        }
      });

      const averageProcessingTime = processingTimeCount > 0 ? totalProcessingTime / processingTimeCount : 0;

      // Get high confidence detections
      const highConfidenceSnapshot = await this.firestore
        .collection('video_analysis_results')
        .where('summary.confidenceScore', '>', 0.7)
        .get();
      const highConfidenceDetections = highConfidenceSnapshot.size;

      return {
        totalVideosProcessed,
        recentAnalyses,
        averageProcessingTime,
        highConfidenceDetections
      };

    } catch (error) {
      videoLogger.error('Error getting statistics from Firestore', error as Error);
      throw error;
    }
  }

  /**
   * Store file metadata (actual files stored in Cloud Storage)
   */
  async storeFileMetadata(
    videoId: string,
    fileType: 'video' | 'thumbnail' | 'result',
    fileName: string,
    contentType: string,
    fileSize: number,
    cloudStorageUrl: string,
    metadata?: object
  ): Promise<string> {
    try {
      const fileId = `${fileType}-${videoId}-${Date.now()}`;
      const docRef = this.firestore.collection('file_storage').doc(fileId);
      
      await docRef.set({
        fileId,
        videoId,
        fileType,
        fileName,
        contentType,
        fileSize,
        cloudStorageUrl,
        metadata: metadata || {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      videoLogger.debug('File metadata stored in Firestore', { 
        fileId, 
        videoId, 
        fileType, 
        fileName, 
        size: fileSize 
      });

      return fileId;

    } catch (error) {
      videoLogger.error('Error storing file metadata in Firestore', error as Error, { 
        videoId, 
        fileType, 
        fileName 
      });
      throw error;
    }
  }

  /**
   * Get file metadata
   */
  async getFileMetadata(fileId: string): Promise<{
    fileName: string;
    contentType: string;
    fileSize: number;
    cloudStorageUrl: string;
    metadata?: object;
  } | null> {
    try {
      const docRef = this.firestore.collection('file_storage').doc(fileId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return null;
      }

      const data = doc.data()!;
      return {
        fileName: data.fileName,
        contentType: data.contentType,
        fileSize: data.fileSize,
        cloudStorageUrl: data.cloudStorageUrl,
        metadata: data.metadata
      };

    } catch (error) {
      videoLogger.error('Error getting file metadata from Firestore', error as Error, { fileId });
      throw error;
    }
  }

  /**
   * Get files by video ID and type
   */
  async getFilesByVideo(
    videoId: string, 
    fileType?: 'video' | 'thumbnail' | 'result'
  ): Promise<Array<{
    fileId: string;
    fileName: string;
    contentType: string;
    fileSize: number;
    fileType: string;
    cloudStorageUrl: string;
    createdAt: string;
  }>> {
    try {
      let query = this.firestore
        .collection('file_storage')
        .where('videoId', '==', videoId);

      if (fileType) {
        query = query.where('fileType', '==', fileType);
      }

      const querySnapshot = await query.orderBy('createdAt', 'desc').get();

      const files: Array<{
        fileId: string;
        fileName: string;
        contentType: string;
        fileSize: number;
        fileType: string;
        cloudStorageUrl: string;
        createdAt: string;
      }> = [];

      querySnapshot.forEach((doc) => {
        const data = doc.data();
        files.push({
          fileId: data.fileId,
          fileName: data.fileName,
          contentType: data.contentType,
          fileSize: data.fileSize,
          fileType: data.fileType,
          cloudStorageUrl: data.cloudStorageUrl,
          createdAt: data.createdAt
        });
      });

      return files;

    } catch (error) {
      videoLogger.error('Error getting files by video from Firestore', error as Error, { 
        videoId, 
        fileType 
      });
      throw error;
    }
  }

  /**
   * Delete file metadata
   */
  async deleteFileMetadata(fileId: string): Promise<void> {
    try {
      const docRef = this.firestore.collection('file_storage').doc(fileId);
      await docRef.delete();

      videoLogger.debug('File metadata deleted from Firestore', { fileId });

    } catch (error) {
      videoLogger.error('Error deleting file metadata from Firestore', error as Error, { fileId });
      throw error;
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStatistics(): Promise<{
    totalFiles: number;
    totalSize: number;
    filesByType: Record<string, { count: number; size: number }>;
  }> {
    try {
      const querySnapshot = await this.firestore.collection('file_storage').get();
      
      let totalFiles = 0;
      let totalSize = 0;
      const filesByType: Record<string, { count: number; size: number }> = {};

      querySnapshot.forEach((doc) => {
        const data = doc.data();
        totalFiles++;
        totalSize += data.fileSize || 0;

        if (!filesByType[data.fileType]) {
          filesByType[data.fileType] = { count: 0, size: 0 };
        }
        filesByType[data.fileType].count++;
        filesByType[data.fileType].size += data.fileSize || 0;
      });

      return {
        totalFiles,
        totalSize,
        filesByType
      };

    } catch (error) {
      videoLogger.error('Error getting storage statistics from Firestore', error as Error);
      throw error;
    }
  }

  /**
   * Clean up old records
   */
  async cleanup(olderThanDays: number = 30): Promise<void> {
    try {
      const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();

      // Delete old analysis results
      const oldResultsQuery = this.firestore
        .collection('video_analysis_results')
        .where('processedAt', '<', cutoffDate);
      
      const oldResultsSnapshot = await oldResultsQuery.get();
      const batch1 = this.firestore.batch();
      
      oldResultsSnapshot.forEach((doc) => {
        batch1.delete(doc.ref);
      });
      
      if (oldResultsSnapshot.size > 0) {
        await batch1.commit();
      }

      // Delete old completed jobs
      const oldJobsQuery = this.firestore
        .collection('processing_jobs')
        .where('status', '==', 'completed')
        .where('completedAt', '<', cutoffDate);
      
      const oldJobsSnapshot = await oldJobsQuery.get();
      const batch2 = this.firestore.batch();
      
      oldJobsSnapshot.forEach((doc) => {
        batch2.delete(doc.ref);
      });
      
      if (oldJobsSnapshot.size > 0) {
        await batch2.commit();
      }

      // Delete old file metadata
      const oldFilesQuery = this.firestore
        .collection('file_storage')
        .where('createdAt', '<', cutoffDate);
      
      const oldFilesSnapshot = await oldFilesQuery.get();
      const batch3 = this.firestore.batch();
      
      oldFilesSnapshot.forEach((doc) => {
        batch3.delete(doc.ref);
      });
      
      if (oldFilesSnapshot.size > 0) {
        await batch3.commit();
      }

      videoLogger.info('Firestore cleanup completed', { 
        olderThanDays,
        deletedResults: oldResultsSnapshot.size,
        deletedJobs: oldJobsSnapshot.size,
        deletedFiles: oldFilesSnapshot.size
      });

    } catch (error) {
      videoLogger.error('Error during Firestore cleanup', error as Error);
      throw error;
    }
  }
} 