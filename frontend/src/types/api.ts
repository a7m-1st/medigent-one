import { z } from 'zod';
import { TimestampSchema } from './common';

export { createApiResponseSchema } from './common';

export const ApiErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  timestamp: TimestampSchema,
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export interface ApiRequestConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  data?: unknown;
  timeout?: number;
  signal?: AbortSignal;
}

export const PaginationMetaSchema = z.object({
  page: z.int().positive(),
  page_size: z.int().positive(),
  total: z.int().nonnegative(),
  total_pages: z.int().nonnegative(),
  has_next: z.boolean(),
  has_prev: z.boolean(),
});
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

export function createPaginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    pagination: PaginationMetaSchema,
    success: z.boolean(),
    message: z.string().optional(),
    timestamp: TimestampSchema,
  });
}
