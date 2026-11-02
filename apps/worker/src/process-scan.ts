import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Job } from 'bullmq';
import {
  crawlLimitsSchema,
  scannerMessageSchema,
  type ScanEvent,
  type ScannerMessage,
} from '@webops/contracts';
import type { WorkerRepository } from './repository.js';

const MAX_LINE_BYTES = 1_048_576;
const root = fileURLToPath(new URL('../../../', import.meta.url));
const scannerCwd = path.join(root, 'services/scanner');
const terminalStatuses = new Set([
  'completed',
  'partial',
  'failed',
  'cancelled',
]);

function stopGroup(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  const hardStop = setTimeout(() => {
    try {
      if (child.pid && child.exitCode === null)
        process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }, 5_000);
  hardStop.unref();
}

function safeMessage(raw: string) {
  return raw
    .replace(/\b(https?:\/\/)[^/@\s]+@/gi, '$1[REDACTED]@')
    .replace(
      /([?&][A-Za-z0-9_-]*(?:token|key|secret|password|auth|session|code)[A-Za-z0-9_-]*=)[^&\s]+/gi,
      '$1[REDACTED]',
    )
    .replace(/(authorization|cookie)\s*[:=]\s*[^\s]+/gi, '$1: [REDACTED]')
    .slice(0, 2_000);
}

function assertApprovedPage(
  message: Extract<ScannerMessage, { type: 'page' | 'candidate' | 'finding' }>,
  origins: string[],
) {
  const urls =
    message.type === 'page'
      ? [message.payload.normalized_url, message.payload.final_url]
      : [message.payload.page_url];
  for (const raw of urls) {
    if (!raw) continue;
    const url = new URL(raw);
    if (
      !origins.includes(url.origin) ||
      !['http:', 'https:'].includes(url.protocol)
    ) {
      throw new Error('Scanner emitted an unapproved page URL');
    }
  }
}

export async function processScan(
  job: Job<{ scanId: string }>,
  repo: WorkerRepository,
  publish: (event: ScanEvent) => Promise<void>,
  active: Set<ChildProcess>,
) {
  const scanId = job.data.scanId;
  const scan = await repo.load(scanId);
  if (!scan) throw new Error('Scan job has no saved policy');
  if (terminalStatuses.has(scan.status)) {
    const coverage = await repo.coverageSoFar(scanId);
    const terminal = await repo.terminal(
      scanId,
      scan.status as 'completed' | 'partial' | 'failed' | 'cancelled',
      coverage,
    );
    await publish(terminal.event).catch(() => undefined);
    return;
  }
  if (scan.cancelRequested) {
    const coverage = await repo.coverageSoFar(scanId);
    const terminal = await repo.terminal(scanId, 'cancelled', coverage);
    await publish(terminal.event).catch(() => undefined);
    return;
  }

  const limits = crawlLimitsSchema.parse(scan.config.crawlLimits);
  const python = path.isAbsolute(process.env.SCANNER_PYTHON ?? '')
    ? process.env.SCANNER_PYTHON!
    : path.resolve(
        root,
        process.env.SCANNER_PYTHON ?? 'services/scanner/.venv/bin/python',
      );
  await repo.markRunning(scanId);
  const start = await repo.appendEvent(
    scanId,
    'running',
    'info',
    'scan',
    'Scan started',
  );
  if (start.inserted) await publish(start.event).catch(() => undefined);

  const child = spawn(python, ['-m', 'scanner.runner'], {
    cwd: scannerCwd,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
  active.add(child);
  child.stdin!.end(
    JSON.stringify({
      v: 1,
      scan_id: scanId,
      base_url: scan.config.baseUrl,
      approved_origins: scan.config.approvedOrigins,
      limits,
      local_fixture_origin:
        process.env.NODE_ENV !== 'production'
          ? (process.env.WEBOPS_LOCAL_FIXTURE_ORIGIN ?? null)
          : null,
    }) + '\n',
  );
  let cancelled = false;
  let timedOut = false;
  let done: Extract<ScannerMessage, { type: 'done' }> | null = null;
  let stderr = '';
  child.stderr!.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-4_000);
  });
  const exit = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: null, signal: null }));
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    stopGroup(child);
  }, limits.scanTimeoutMs);
  const cancelPoll = setInterval(() => {
    void repo
      .isCancelRequested(scanId)
      .then((requested) => {
        if (requested && !cancelled) {
          cancelled = true;
          stopGroup(child);
        }
      })
      .catch(() => undefined);
  }, 1_000);

  try {
    let buffer = Buffer.alloc(0);
    for await (const chunk of child.stdout!) {
      buffer = Buffer.concat([buffer, chunk as Buffer]);
      let newline: number;
      while ((newline = buffer.indexOf(10)) >= 0) {
        const line = buffer.subarray(0, newline);
        buffer = buffer.subarray(newline + 1);
        if (line.length > MAX_LINE_BYTES)
          throw new Error('Scanner protocol line exceeded limit');
        if (line.length === 0) continue;
        let raw: unknown;
        try {
          raw = JSON.parse(line.toString('utf8'));
        } catch {
          throw new Error('Malformed scanner protocol JSON');
        }
        const parsed = scannerMessageSchema.safeParse(raw);
        if (!parsed.success)
          throw new Error('Invalid scanner protocol message');
        const message = parsed.data;
        if (message.scan_id !== scanId) throw new Error('Scanner ID mismatch');
        if (done) throw new Error('Scanner sent data after done');
        if (message.type === 'event') {
          const entry = await repo.appendEvent(
            scanId,
            message.idempotency_key,
            message.payload.level,
            message.payload.phase,
            safeMessage(message.payload.message),
            message.payload.data,
          );
          if (entry.inserted) await publish(entry.event).catch(() => undefined);
        } else if (message.type === 'page') {
          assertApprovedPage(message, scan.config.approvedOrigins);
          await repo.savePage(scanId, message);
          const entry = await repo.appendEvent(
            scanId,
            `page:${createHash('sha256').update(message.payload.normalized_url).digest('hex')}`,
            'info',
            'crawl',
            `Visited ${message.payload.normalized_url}`,
            {
              url: message.payload.normalized_url,
              status: message.payload.http_status,
            },
          );
          if (entry.inserted) await publish(entry.event).catch(() => undefined);
        } else if (message.type === 'done') {
          done = message;
        }
      }
      if (buffer.length > MAX_LINE_BYTES)
        throw new Error('Scanner protocol line exceeded limit');
    }
    if (buffer.length > 0) throw new Error('Scanner output ended mid-line');
    const ended = await exit;
    if (cancelled) {
      const coverage = await repo.coverageSoFar(scanId);
      const terminal = await repo.terminal(scanId, 'cancelled', coverage);
      await publish(terminal.event).catch(() => undefined);
      return;
    }
    if (timedOut) throw new Error('Scanner process timed out');
    if (ended.code !== 0)
      throw new Error(`Scanner exited with code ${ended.code ?? 'unknown'}`);
    if (!done) throw new Error('Scanner did not send done');
    const payload = done.payload;
    const terminal = await repo.terminal(
      scanId,
      payload.complete ? 'completed' : 'partial',
      {
        visitedUrls: payload.visited_urls,
        skipped: payload.skipped,
        failedCount: payload.failed_count,
        limitations: payload.limitations,
      },
    );
    await publish(terminal.event).catch(() => undefined);
  } catch (error) {
    stopGroup(child);
    await exit;
    const message = error instanceof Error ? error.message : 'Scanner failed';
    process.stderr.write(
      `scan ${scanId}: ${safeMessage(message)}; diagnostic: ${safeMessage(stderr)}\n`,
    );
    const attempt = job.attemptsMade + 1;
    const warning = await repo.appendEvent(
      scanId,
      `attempt:${attempt}:failed`,
      'error',
      'worker',
      `Scanner attempt ${attempt} failed`,
      { attempt },
    );
    if (warning.inserted) await publish(warning.event).catch(() => undefined);
    if (attempt >= (job.opts.attempts ?? 1)) {
      const coverage = await repo.coverageSoFar(scanId);
      const status = coverage.visitedUrls.length ? 'partial' : 'failed';
      const terminal = await repo.terminal(
        scanId,
        status,
        coverage,
        safeMessage(message),
      );
      await publish(terminal.event).catch(() => undefined);
      return;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    clearInterval(cancelPoll);
    active.delete(child);
  }
}
