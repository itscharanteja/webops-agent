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

export const SCAN_QUEUE_NAME = 'webops-scans';
export const SCANNER_PROTOCOL_VERSION = 1;

export const scanSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  status: scanStatusSchema,
  queuedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  visitedCount: z.number().int(),
  skippedCount: z.number().int(),
  failedCount: z.number().int(),
  cancelRequestedAt: z.string().datetime().nullable(),
  error: z.string().nullable(),
});

export const scanEventSchema = z.object({
  scanId: z.string().uuid(),
  seq: z.number().int().positive(),
  at: z.string().datetime(),
  level: eventLevelSchema,
  phase: z.string(),
  message: z.string(),
  payload: z.record(z.unknown()),
});

export const scanPageSchema = z.object({
  id: z.string().uuid(),
  scanId: z.string().uuid(),
  normalizedUrl: z.string().url(),
  finalUrl: z.string().url().nullable(),
  depth: z.number().int().min(0),
  httpStatus: z.number().int().nullable(),
  title: z.string().nullable(),
  timingMs: z.number().int().nullable(),
  visitedAt: z.string().datetime().nullable(),
  consoleMessages: z.array(z.string()),
  failedRequests: z.array(z.object({ url: z.string(), error: z.string() })),
  screenshots: z.array(
    z.object({ id: z.string().uuid(), viewport: z.string() }),
  ),
});

export const scanListSchema = z.object({
  items: z.array(scanSchema),
  nextOffset: z.number().int().nullable(),
});
export const scanEventsResponseSchema = z.object({
  items: z.array(scanEventSchema),
  nextAfter: z.number().int().min(0),
});
export const scanPagesResponseSchema = z.object({
  items: z.array(scanPageSchema),
  nextOffset: z.number().int().nullable(),
});
export const scanCoverageSchema = z.object({
  v: z.literal(1),
  visitedUrls: z.array(z.string()),
  skipped: z.array(z.object({ url: z.string(), reason: z.string() })),
  failedCount: z.number().int(),
  limitations: z.array(z.string()),
});
export const citationSchema = z.object({
  evidenceId: z.string().uuid(),
  label: z.string(),
  kind: evidenceKindSchema,
});

export const reportIssueSnapshotItemSchema = z.object({
  issueId: z.string().uuid(),
  fingerprint: z.string(),
  title: z.string(),
  description: z.string(),
  priority: z.enum(priorities),
  status: z.enum(issueStatuses),
  affectedUrl: z.string().url().nullable(),
  ruleId: z.string(),
  ruleVersion: z.string(),
  detectedSeverity: z.enum(priorities),
  confidence: z.number(),
  facts: z.record(z.unknown()),
  explanation: z.record(z.unknown()),
  evidenceIds: z.array(z.string().uuid()),
  citations: z.array(
    z.object({
      evidenceId: z.string().uuid(),
      label: z.string(),
      kind: z.enum(evidenceKinds),
    }),
  ),
});
export type ReportIssueSnapshotItem = z.infer<
  typeof reportIssueSnapshotItemSchema
>;

export const scanReportSchema = z.object({
  id: z.string().uuid(),
  scanId: z.string().uuid(),
  summary: z.record(z.unknown()),
  coverage: scanCoverageSchema,
  issueSnapshot: z.array(reportIssueSnapshotItemSchema),
  createdAt: z.string().datetime(),
});

export const reportSummaryItemSchema = z.object({
  id: z.string().uuid(),
  scanId: z.string().uuid(),
  projectId: z.string().uuid(),
  summary: z.record(z.unknown()),
  coverage: scanCoverageSchema,
  issueCount: z.number().int().nullable(),
  createdAt: z.string().datetime(),
});
export const reportListSchema = z.object({
  items: z.array(reportSummaryItemSchema),
  nextOffset: z.number().int().nullable(),
});
export type ReportSummaryItem = z.infer<typeof reportSummaryItemSchema>;

const scannerHeader = z.object({
  v: z.literal(SCANNER_PROTOCOL_VERSION),
  scan_id: z.string().uuid(),
  idempotency_key: z.string().min(1).max(256),
});
const scannerEventPayload = z.object({
  level: eventLevelSchema,
  phase: z.string().min(1).max(80),
  message: z.string().min(1).max(2000),
  data: z.record(z.unknown()).default({}),
});
const scannerPagePayload = z.object({
  normalized_url: z.string().url(),
  final_url: z.string().url().nullable(),
  depth: z.number().int().min(0),
  http_status: z.number().int().min(100).max(599).nullable(),
  title: z.string().max(500).nullable(),
  timing_ms: z.number().int().min(0).nullable(),
  visited_at: z.string().datetime(),
  console_messages: z.array(z.string().max(2000)).max(100),
  failed_requests: z
    .array(z.object({ url: z.string().max(2048), error: z.string().max(500) }))
    .max(100),
});
const scannerDonePayload = z.object({
  visited_urls: z.array(z.string().url()).max(100),
  skipped: z
    .array(z.object({ url: z.string().max(2048), reason: z.string().max(200) }))
    .max(500),
  failed_count: z.number().int().min(0),
  limitations: z.array(z.string().max(500)).max(100),
  complete: z.boolean(),
});

export const scannerEvidenceSchema = z.object({
  kind: evidenceKindSchema,
  locator: z.string().max(500).nullable(),
  payload: z.record(z.unknown()),
  artifact_base64: z.string().max(800_000).nullable().optional(),
  mime_type: z.enum(['image/jpeg', 'image/png']).nullable().optional(),
});
export const scannerFindingSchema = z.object({
  page_url: z.string().url().max(2048),
  rule_id: z.enum([
    'HTTP_PAGE_ERROR',
    'BROKEN_INTERNAL_LINK',
    'JS_CONSOLE_ERROR',
    'FAILED_FIRST_PARTY_REQUEST',
    'MISSING_IMAGE_ALT',
    'UNLABELED_FORM_CONTROL',
    'MISSING_PAGE_TITLE',
    'HORIZONTAL_OVERFLOW',
  ]),
  rule_version: z.literal('1'),
  target: z.string().min(1).max(1000),
  title: z.string().min(1).max(200),
  description: z.string().max(4000),
  priority: prioritySchema,
  confidence: z.number().min(0).max(1),
  observed: z.string().min(1).max(4000),
  impact: z.string().min(1).max(2000),
  reproduction_steps: z.array(z.string().min(1).max(500)).min(1).max(10),
  suggested_fix: z.string().min(1).max(2000),
  facts: z.record(z.unknown()),
  evidence: z.array(scannerEvidenceSchema).min(1).max(6),
});
export const scannerPageScreenshotSchema = z.object({
  page_url: z.string().url().max(2048),
  viewport: z.enum(['desktop', 'mobile']),
  artifact_base64: z.string().max(800_000),
  mime_type: z.literal('image/jpeg'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const scannerMessageSchema = z.discriminatedUnion('type', [
  scannerHeader.extend({
    type: z.literal('event'),
    payload: scannerEventPayload,
  }),
  scannerHeader.extend({
    type: z.literal('page'),
    payload: scannerPagePayload,
  }),
  scannerHeader.extend({
    type: z.literal('done'),
    payload: scannerDonePayload,
  }),
  scannerHeader.extend({
    type: z.literal('candidate'),
    payload: scannerPageScreenshotSchema,
  }),
  scannerHeader.extend({
    type: z.literal('finding'),
    payload: scannerFindingSchema,
  }),
]);
export type ScannerMessage = z.infer<typeof scannerMessageSchema>;
export type Scan = z.infer<typeof scanSchema>;
export type ScanEvent = z.infer<typeof scanEventSchema>;
export type ScanPage = z.infer<typeof scanPageSchema>;

export const issuePatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(4000).optional(),
    priority: prioritySchema.optional(),
    status: issueStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
export const observationSchema = z.object({
  id: z.string().uuid(),
  scanId: z.string().uuid(),
  pageId: z.string().uuid(),
  ruleId: z.string(),
  ruleVersion: z.string(),
  detectedSeverity: z.enum(priorities),
  confidence: z.number(),
  facts: z.record(z.unknown()),
  explanation: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  citations: z.array(citationSchema),
});
export const issueSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  fingerprint: z.string(),
  title: z.string(),
  description: z.string(),
  priority: prioritySchema,
  status: issueStatusSchema,
  version: z.number().int(),
  firstSeen: z.string().datetime(),
  lastSeen: z.string().datetime(),
  notSeen: z.boolean(),
  affectedUrl: z.string().url().nullable(),
  latestRuleId: z.string().nullable(),
  latestObservedAt: z.string().datetime().nullable(),
  confidence: z.number().nullable(),
  evidenceCount: z.number().int(),
});
export const issueDetailSchema = issueSchema.extend({
  observations: z.array(observationSchema),
  revisions: z.array(
    z.object({
      at: z.string().datetime(),
      editorId: z.string().uuid(),
      version: z.number().int(),
      oldValues: z.record(z.unknown()),
      newValues: z.record(z.unknown()),
    }),
  ),
});
export const issueListSchema = z.object({
  items: z.array(issueSchema),
  nextOffset: z.number().int().nullable(),
});
export const evidenceSchema = z.object({
  id: z.string().uuid(),
  scanId: z.string().uuid(),
  pageId: z.string().uuid().nullable(),
  projectId: z.string().uuid(),
  kind: evidenceKindSchema,
  capturedAt: z.string().datetime(),
  locator: z.string().nullable(),
  payload: z.record(z.unknown()),
  verified: z.boolean(),
  retainedUntil: z.string().datetime().nullable(),
  artifactUrl: z.string().nullable(),
  available: z.boolean(),
  sourceUrl: z.string().url().nullable(),
  ruleIds: z.array(z.string()),
  issueIds: z.array(z.string().uuid()),
});
export type Issue = z.infer<typeof issueSchema>;
export type IssueDetail = z.infer<typeof issueDetailSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
