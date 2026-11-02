import { createHash } from 'node:crypto';

export function fingerprint(
  ruleId: string,
  normalizedPageUrl: string,
  stableTarget: string,
): string {
  return createHash('sha256')
    .update(JSON.stringify([ruleId, normalizedPageUrl, stableTarget]))
    .digest('hex');
}
