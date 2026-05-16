import { apiRequest, handleApiError } from '@/lib/api';
import type {
  HumanReply,
} from '@/types';
import {
  HumanReplySchema,
} from '@/types';
import { z } from 'zod';

/**
 * Stop a running chat session.
 * Backend endpoint: DELETE /chat/{task_id}
 *
 * Kept as a REST fallback for when the WebSocket is not connected.
 */
export async function stopChat(taskId: string): Promise<void> {
  try {
    if (!taskId || typeof taskId !== 'string') {
      throw new Error('Invalid task ID');
    }
    
    await apiRequest<void>({
      method: 'DELETE',
      url: `/chat/${taskId}`,
      responseSchema: z.void(),
    });
  } catch (error) {
    const apiError = handleApiError(error);
    throw apiError;
  }
}

/**
 * Send a human reply to an agent's question.
 * Backend endpoint: POST /chat/{project_id}/human-reply
 *
 * Kept as a REST fallback for when the WebSocket is not connected.
 */
export async function sendHumanReply(
  projectId: string,
  data: HumanReply
): Promise<void> {
  try {
    if (!projectId || typeof projectId !== 'string') {
      throw new Error('Invalid project ID');
    }
    
    const validatedData = HumanReplySchema.parse(data);
    
    await apiRequest<void>({
      method: 'POST',
      url: `/chat/${projectId}/human-reply`,
      data: validatedData,
      responseSchema: z.void(),
    });
  } catch (error) {
    const apiError = handleApiError(error);
    throw apiError;
  }
}
