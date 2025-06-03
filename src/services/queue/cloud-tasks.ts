import { config } from '@/config';
import { ProcessingJob } from '@/types';
import { pubsubLogger } from '@/utils/logger';
import { CloudTasksClient } from '@google-cloud/tasks';

export class CloudTasksService {
  private client: CloudTasksClient;
  private queuePath: string;
  private projectId: string;

  constructor() {
    this.projectId = config.googleCloud.projectId || 'smart-glasses-447114';
    
    this.client = new CloudTasksClient({
      projectId: this.projectId,
    });

    // Create queue path
    this.queuePath = this.client.queuePath(
      this.projectId,
      'us-central1', // Default location
      'video-processing-queue'
    );

    pubsubLogger.info('Cloud Tasks Service initialized', {
      projectId: this.projectId,
      queuePath: this.queuePath
    });
  }

  /**
   * Initialize the task queue
   */
  async initializeQueue(): Promise<void> {
    try {
      // Check if queue exists, create if not
      try {
        await this.client.getQueue({ name: this.queuePath });
        pubsubLogger.info('Cloud Tasks queue already exists');
      } catch (error: any) {
        if (error.code === 5) { // NOT_FOUND
          // Create the queue
          const parent = this.client.locationPath(this.projectId, 'us-central1');
          
          await this.client.createQueue({
            parent,
            queue: {
              name: this.queuePath,
              rateLimits: {
                maxDispatchesPerSecond: 10,
                maxBurstSize: 100,
                maxConcurrentDispatches: 5
              },
              retryConfig: {
                maxAttempts: 3,
                maxRetryDuration: { seconds: 300 }, // 5 minutes
                minBackoff: { seconds: 2 },
                maxBackoff: { seconds: 60 },
                maxDoublings: 5
              }
            }
          });
          
          pubsubLogger.info('Cloud Tasks queue created successfully');
        } else {
          throw error;
        }
      }

    } catch (error) {
      pubsubLogger.error('Error initializing Cloud Tasks queue', error as Error);
      throw error;
    }
  }

  /**
   * Add a video processing task to the queue
   */
  async addVideoProcessingTask(
    videoId: string,
    videoData: any,
    priority: 'high' | 'medium' | 'low' = 'medium',
    delay?: number
  ): Promise<string> {
    try {
      const taskId = `video-${videoId}-${Date.now()}`;
      
      // Create the task payload
      const payload = {
        videoId,
        videoData,
        priority,
        createdAt: new Date().toISOString()
      };

      // Create the task
      const task: any = {
        name: `${this.queuePath}/tasks/${taskId}`,
        httpRequest: {
          httpMethod: 'POST',
          url: `http://localhost:${config.server.port}/api/tasks/process-video`,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer internal-task`
          },
          body: Buffer.from(JSON.stringify(payload))
        }
      };

      // Add delay if specified
      if (delay && delay > 0) {
        const scheduleTime = new Date(Date.now() + delay * 1000);
        task.scheduleTime = {
          seconds: Math.floor(scheduleTime.getTime() / 1000)
        };
      }

      // Create the task
      const [response] = await this.client.createTask({
        parent: this.queuePath,
        task
      });

      pubsubLogger.info('Video processing task added to Cloud Tasks', {
        taskId,
        videoId,
        priority,
        taskName: response.name
      });

      return taskId;

    } catch (error) {
      pubsubLogger.error('Error adding video processing task', error as Error, {
        videoId,
        priority
      });
      throw error;
    }
  }

  /**
   * Add a thumbnail analysis task
   */
  async addThumbnailAnalysisTask(
    videoId: string,
    thumbnailUrl: string,
    priority: 'high' | 'medium' | 'low' = 'medium'
  ): Promise<string> {
    try {
      const taskId = `thumbnail-${videoId}-${Date.now()}`;
      
      const payload = {
        videoId,
        thumbnailUrl,
        priority,
        type: 'thumbnail-analysis',
        createdAt: new Date().toISOString()
      };

      const task: any = {
        name: `${this.queuePath}/tasks/${taskId}`,
        httpRequest: {
          httpMethod: 'POST',
          url: `http://localhost:${config.server.port}/api/tasks/analyze-thumbnail`,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer internal-task`
          },
          body: Buffer.from(JSON.stringify(payload))
        }
      };

      const [response] = await this.client.createTask({
        parent: this.queuePath,
        task
      });

      pubsubLogger.info('Thumbnail analysis task added to Cloud Tasks', {
        taskId,
        videoId,
        thumbnailUrl,
        taskName: response.name
      });

      return taskId;

    } catch (error) {
      pubsubLogger.error('Error adding thumbnail analysis task', error as Error, {
        videoId,
        thumbnailUrl
      });
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    queueName: string;
    tasksCount: number;
    oldestTask?: Date;
    executedLastMinute: number;
    executedLastHour: number;
  }> {
    try {
      // Get queue information
      const [queue] = await this.client.getQueue({ name: this.queuePath });
      
      // List tasks in the queue
      const [tasks] = await this.client.listTasks({
        parent: this.queuePath,
        pageSize: 100
      });

      let oldestTask: Date | undefined;
      if (tasks.length > 0) {
        // Find the oldest task
        const oldestTaskTime = tasks.reduce((oldest, task) => {
          if (task.createTime && task.createTime.seconds) {
            const createTime = new Date(Number(task.createTime.seconds) * 1000);
            return !oldest || createTime < oldest ? createTime : oldest;
          }
          return oldest;
        }, undefined as Date | undefined);
        
        oldestTask = oldestTaskTime;
      }

      // Note: Cloud Tasks doesn't provide execution statistics directly
      // These would need to be tracked separately in your application
      const executedLastMinute = 0; // Placeholder
      const executedLastHour = 0; // Placeholder

      return {
        queueName: queue.name || '',
        tasksCount: tasks.length,
        oldestTask,
        executedLastMinute,
        executedLastHour
      };

    } catch (error) {
      pubsubLogger.error('Error getting queue statistics', error as Error);
      throw error;
    }
  }

  /**
   * Pause the queue
   */
  async pauseQueue(): Promise<void> {
    try {
      await this.client.pauseQueue({ name: this.queuePath });
      pubsubLogger.info('Cloud Tasks queue paused');
    } catch (error) {
      pubsubLogger.error('Error pausing queue', error as Error);
      throw error;
    }
  }

  /**
   * Resume the queue
   */
  async resumeQueue(): Promise<void> {
    try {
      await this.client.resumeQueue({ name: this.queuePath });
      pubsubLogger.info('Cloud Tasks queue resumed');
    } catch (error) {
      pubsubLogger.error('Error resuming queue', error as Error);
      throw error;
    }
  }

  /**
   * Purge all tasks from the queue
   */
  async purgeQueue(): Promise<void> {
    try {
      await this.client.purgeQueue({ name: this.queuePath });
      pubsubLogger.info('Cloud Tasks queue purged');
    } catch (error) {
      pubsubLogger.error('Error purging queue', error as Error);
      throw error;
    }
  }

  /**
   * Delete a specific task
   */
  async deleteTask(taskName: string): Promise<void> {
    try {
      await this.client.deleteTask({ name: taskName });
      pubsubLogger.debug('Task deleted from Cloud Tasks', { taskName });
    } catch (error) {
      pubsubLogger.error('Error deleting task', error as Error, { taskName });
      throw error;
    }
  }

  /**
   * Create a processing job record (for compatibility with existing code)
   */
  async createJob(job: ProcessingJob): Promise<string> {
    try {
      // Add the job as a task to Cloud Tasks
      const taskId = await this.addVideoProcessingTask(
        job.videoId,
        { job },
        job.priority as 'high' | 'medium' | 'low'
      );

      pubsubLogger.info('Processing job created as Cloud Task', {
        jobId: job.id,
        taskId,
        videoId: job.videoId
      });

      return taskId;

    } catch (error) {
      pubsubLogger.error('Error creating processing job', error as Error, {
        jobId: job.id
      });
      throw error;
    }
  }

  /**
   * Get processing status (simplified for Cloud Tasks)
   */
  async getProcessingStatus(): Promise<{
    queueStats: any;
    isProcessing: boolean;
  }> {
    try {
      const stats = await this.getQueueStats();
      
      return {
        queueStats: {
          waiting: stats.tasksCount,
          active: 0, // Cloud Tasks doesn't expose this directly
          completed: 0, // Would need to be tracked separately
          failed: 0 // Would need to be tracked separately
        },
        isProcessing: stats.tasksCount > 0
      };

    } catch (error) {
      pubsubLogger.error('Error getting processing status', error as Error);
      throw error;
    }
  }
} 