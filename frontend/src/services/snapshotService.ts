import { apiClient } from '@/lib/api';
import { z } from 'zod';
import type { SnapshotEntry } from '@/stores';

// ============================================
// Zod Schema for API Response
// ============================================
const SnapshotResponseItemSchema = z.object({
  camel_task_id: z.string(),
  browser_url: z.string(),
  image_data: z.string(), // base64 encoded image
  timestamp: z.string(), // ISO date string
});

const SnapshotsResponseSchema = z.array(SnapshotResponseItemSchema);

// ============================================
// Service Functions
// ============================================
export const snapshotService = {
  /**
   * Fetch snapshots for a specific task
   * GET /api/chat/snapshots?api_task_id={taskId}
   */
  async fetchSnapshots(taskId: string): Promise<SnapshotEntry[]> {
    try {
      const response = await apiClient.get('/chat/snapshots', {
        params: { api_task_id: taskId },
      });
      
      const validated = SnapshotsResponseSchema.safeParse(response.data);
      if (!validated.success) {
        console.error('Invalid snapshots response:', validated.error);
        return [];
      }
      
      return validated.data.map((item, index) => ({
        id: `${taskId}-${index}-${Date.now()}`,
        taskId: item.camel_task_id,
        browserUrl: item.browser_url,
        imageData: item.image_data,
        timestamp: new Date(item.timestamp),
      }));
    } catch (error) {
      console.error('Failed to fetch snapshots:', error);
      return [];
    }
  },
  
  /**
   * Fetch latest snapshot for a task
   */
  async fetchLatestSnapshot(taskId: string): Promise<SnapshotEntry | null> {
    const snapshots = await this.fetchSnapshots(taskId);
    if (snapshots.length === 0) return null;
    
    // Return the most recent snapshot
    return snapshots.sort((a, b) => 
      b.timestamp.getTime() - a.timestamp.getTime()
    )[0];
  },
};
