import { z } from 'zod';
export type { paths as ApiPaths } from './openapi.generated.js';

export const scanStatuses = [
  'queued',
  'running',
  'completed',
  'partial',
  'failed',
  'cancelled',
] as const;
export const issueStatuses = [
  'open',
  'in_progress',
  'resolved',
  'wont_fix',
] as const;
export const priorities = ['P0', 'P1', 'P2', 'P3'] as const;
export const eventLevels = ['debug', 'info', 'warn', 'error'] as const;
export const evidenceKinds = [
  'screenshot',
  'dom',
  'console',
  'network',
  'url',
] as const;
export const memberRoles = ['owner', 'editor', 'viewer'] as const;

export const scanStatusSchema = z.enum(scanStatuses);
export const issueStatusSchema = z.enum(issueStatuses);
export const prioritySchema = z.enum(priorities);
export const eventLevelSchema = z.enum(eventLevels);
export const evidenceKindSchema = z.enum(evidenceKinds);
export const memberRoleSchema = z.enum(memberRoles);

export const crawlLimitsSchema = z.object({
  maxPages: z.number().int().min(1).max(100).default(25),
  maxDepth: z.number().int().min(0).max(5).default(3),
  concurrency: z.number().int().min(1).max(4).default(2),
  navigationTimeoutMs: z.number().int().min(1000).max(30000).default(10000),
  pageTimeoutMs: z.number().int().min(5000).max(120000).default(60000),
  scanTimeoutMs: z.number().int().min(30000).max(1800000).default(900000),
  requestsPerSecond: z.number().min(0.1).max(5).default(2),
});

export const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  baseUrl: z.string().url().max(2048),
  approvedOrigins: z.array(z.string().url().max(2048)).min(1).max(10),
  authorizationConfirmed: z.literal(true),
  crawlLimits: crawlLimitsSchema.partial().optional(),
});

export const projectPatchSchema = projectInputSchema
  .partial()
  .omit({ authorizationConfirmed: true })
  .extend({
    authorizationConfirmed: z.literal(true).optional(),
  });

export const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  baseUrl: z.string().url(),
  approvedOrigins: z.array(z.string().url()),
  crawlLimits: crawlLimitsSchema,
  createdAt: z.string().datetime(),
});

export const projectListSchema = z.object({
  items: z.array(projectSchema),
  nextOffset: z.number().int().nullable(),
});

export const structuredErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});

export type CrawlLimits = z.infer<typeof crawlLimitsSchema>;
export type ProjectInput = z.infer<typeof projectInputSchema>;
export type ProjectPatch = z.infer<typeof projectPatchSchema>;
export type Project = z.infer<typeof projectSchema>;
