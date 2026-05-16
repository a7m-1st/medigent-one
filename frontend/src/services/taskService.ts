import { apiRequest, handleApiError } from '@/lib/api';
import type { Task } from '@/types';
import { TaskSchema } from '@/types';
import { z } from 'zod';

const TaskArraySchema = z.array(TaskSchema);

export async function startTask(taskId: string): Promise<void> {
  try {
    if (!taskId || typeof taskId !== 'string') {
      throw new Error('Invalid task ID');
    }
    
    // Backend returns 201 with no content, but axios may receive empty string
    // Use schema that accepts void, null, or empty string
    await apiRequest<void>({
      method: 'POST',
      url: `/task/${taskId}/start`,
      responseSchema: z.union([z.void(), z.null(), z.literal(''), z.any()]).transform(() => undefined),
    });
  } catch (error) {
    const apiError = handleApiError(error);
    throw apiError;
  }
}

export async function stopAllTasks(): Promise<void> {
  try {
    await apiRequest<void>({
      method: 'POST',
      url: '/tasks/stop-all',
      responseSchema: z.void(),
    });
  } catch (error) {
    const apiError = handleApiError(error);
    throw apiError;
  }
}

export async function getTask(taskId: string): Promise<Task> {
  try {
    if (!taskId || typeof taskId !== 'string') {
      throw new Error('Invalid task ID');
    }
    
    const response = await apiRequest<Task>({
      method: 'GET',
      url: `/tasks/${taskId}`,
      responseSchema: TaskSchema,
    });
    
    return response;
  } catch (error) {
    const apiError = handleApiError(error);
    throw apiError;
  }
}

export async function getProjectTasks(projectId: string): Promise<Task[]> {
  try {
    if (!projectId || typeof projectId !== 'string') {
      throw new Error('Invalid project ID');
    }
    
    const response = await apiRequest<Task[]>({
      method: 'GET',
      url: `/projects/${projectId}/tasks`,
      responseSchema: TaskArraySchema,
    });
    
    return response;
  } catch (error) {
    const apiError = handleApiError(error);
    throw apiError;
  }
}

export async function deleteTask(taskId: string): Promise<void> {
  try {
    if (!taskId || typeof taskId !== 'string') {
      throw new Error('Invalid task ID');
    }
    
    await apiRequest<void>({
      method: 'DELETE',
      url: `/tasks/${taskId}`,
      responseSchema: z.void(),
    });
  } catch (error) {
    const apiError = handleApiError(error);
    throw apiError;
  }
}
