import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import type { ZodSchema } from 'zod';
import { ZodError } from 'zod';
import { ApiErrorSchema, type ApiError } from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError<ApiError>) => {
    if (error.response) {
      const status = error.response.status;
      
      if (status === 401) {
        localStorage.removeItem('auth_token');
        window.location.href = '/login';
      }
      
      if (status === 403) {
        console.error('Access forbidden:', error.response.data);
      }
      
      if (status >= 500) {
        console.error('Server error:', error.response.data);
      }
    } else if (error.request) {
      console.error('Network error - no response received');
    } else {
      console.error('Request setup error:', error.message);
    }
    
    return Promise.reject(error);
  }
);

export interface ApiRequestOptions<TResponse> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  data?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  responseSchema: ZodSchema<TResponse>;
  timeout?: number;
}

export async function apiRequest<TResponse>(
  options: ApiRequestOptions<TResponse>
): Promise<TResponse> {
  const {
    method = 'GET',
    url,
    data,
    params,
    headers,
    responseSchema,
    timeout,
  } = options;

  try {
    const config: AxiosRequestConfig = {
      method,
      url,
      data,
      params,
      headers,
      timeout,
    };

    const response = await apiClient.request(config);
    
    // For 204 No Content responses, skip validation and return undefined
    if (response.status === 204 || response.data === undefined || response.data === '') {
      return undefined as TResponse;
    }
    
    const validatedData = responseSchema.parse(response.data);
    return validatedData;
  } catch (error) {
    if (error instanceof ZodError) {
      console.error('Response validation failed:', error.issues);
      throw new Error(`API response validation failed: ${error.issues.map(e => e.message).join(', ')}`);
    }
    throw error;
  }
}

export function handleApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiError>;
    
    if (axiosError.response?.data) {
      try {
        return ApiErrorSchema.parse(axiosError.response.data);
      } catch {
        return {
          success: false,
          error: axiosError.response.data.error || 'An error occurred',
          code: axiosError.response.status.toString(),
          timestamp: new Date().toISOString(),
        };
      }
    }
    
    if (axiosError.request) {
      return {
        success: false,
        error: 'Network error. Please check your connection.',
        code: 'NETWORK_ERROR',
        timestamp: new Date().toISOString(),
      };
    }
    
    return {
      success: false,
      error: axiosError.message || 'Request failed',
      code: 'REQUEST_ERROR',
      timestamp: new Date().toISOString(),
    };
  }
  
  if (error instanceof Error) {
    return {
      success: false,
      error: error.message,
      code: 'UNKNOWN_ERROR',
      timestamp: new Date().toISOString(),
    };
  }
  
  return {
    success: false,
    error: 'An unknown error occurred',
    code: 'UNKNOWN_ERROR',
    timestamp: new Date().toISOString(),
  };
}

export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'error' in error &&
    typeof (error as ApiError).error === 'string'
  );
}
