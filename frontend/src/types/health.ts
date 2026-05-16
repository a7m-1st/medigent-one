import { z } from 'zod';
import { TimestampSchema } from './common';

export const HealthStatusEnum = z.enum(['healthy', 'degraded', 'unhealthy']);
export type HealthStatus = z.infer<typeof HealthStatusEnum>;

export const HealthResponseSchema = z.object({
  status: HealthStatusEnum,
  timestamp: TimestampSchema,
  version: z.string(),
  uptime: z.number(),
  checks: z.record(z.string(), z.object({
    status: HealthStatusEnum,
    response_time: z.number(),
    message: z.string().optional(),
  })).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
