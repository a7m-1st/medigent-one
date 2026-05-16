import { apiRequest, handleApiError } from '@/lib/api';
import type { HealthResponse } from '@/types';
import { HealthResponseSchema } from '@/types';

export async function checkHealth(): Promise<HealthResponse> {
  try {
    const response = await apiRequest<HealthResponse>({
      method: 'GET',
      url: '/health',
      responseSchema: HealthResponseSchema,
    });
    
    return response;
  } catch (error) {
    const apiError = handleApiError(error);
    throw apiError;
  }
}
