import type { ScannerMessage } from '@webops/contracts';

type Finding = Extract<ScannerMessage, { type: 'finding' }>['payload'];
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
function status(value: unknown): number | null {
  const parsed =
    typeof value === 'number' || typeof value === 'string'
      ? Number(value)
      : NaN;
  return Number.isInteger(parsed) ? parsed : null;
}

export function validateFinding(finding: Finding): void {
  const proof = (kind: string) =>
    finding.evidence.filter((item) => item.kind === kind);
  const dom = proof('dom');
  const screenshot = proof('screenshot');
  const url = proof('url');
  const network = proof('network');
  const consoleProof = proof('console');
  const hasScreenshot = screenshot.some(
    (item) =>
      text(item.artifact_base64) &&
      ['image/jpeg', 'image/png'].includes(item.mime_type ?? ''),
  );
  let valid = false;
  switch (finding.rule_id) {
    case 'HTTP_PAGE_ERROR':
      valid = url.some((item) => {
        const data = object(item.payload);
        return (
          data.sourceUrl === finding.page_url &&
          (Number(data.status) >= 400 || text(data.error))
        );
      });
      break;
    case 'BROKEN_INTERNAL_LINK':
      valid =
        dom.some(
          (item) =>
            text(item.locator) &&
            object(item.payload).sourceUrl === finding.page_url,
        ) &&
        url.some((item) => {
          const data = object(item.payload);
          return (
            data.sourceUrl === finding.page_url &&
            data.destinationUrl === finding.target &&
            (Number(data.status) >= 400 || text(data.error))
          );
        });
      break;
    case 'JS_CONSOLE_ERROR':
      valid = consoleProof.some((item) => {
        const messages = object(item.payload).messages;
        return Array.isArray(messages) && messages.some(text);
      });
      break;
    case 'FAILED_FIRST_PARTY_REQUEST':
      valid = network.some((item) => {
        const data = object(item.payload);
        return (
          text(data.method) &&
          text(data.url) &&
          ((status(data.status) ?? 0) >= 500 || text(data.failure))
        );
      });
      break;
    case 'MISSING_IMAGE_ALT':
      valid =
        hasScreenshot &&
        dom.some(
          (item) =>
            text(item.locator) &&
            text(object(item.payload).excerpt) &&
            !/\balt\s*=/.test(String(object(item.payload).excerpt)),
        );
      break;
    case 'UNLABELED_FORM_CONTROL':
      valid =
        hasScreenshot &&
        dom.some(
          (item) => text(item.locator) && text(object(item.payload).excerpt),
        );
      break;
    case 'MISSING_PAGE_TITLE':
      valid = dom.some(
        (item) =>
          text(object(item.payload).excerpt) &&
          !/<title\b/i.test(String(object(item.payload).excerpt)),
      );
      break;
    case 'HORIZONTAL_OVERFLOW': {
      const facts = object(finding.facts);
      valid =
        hasScreenshot &&
        typeof facts.documentWidth === 'number' &&
        typeof facts.viewportWidth === 'number' &&
        facts.documentWidth > facts.viewportWidth + 8;
      break;
    }
    case 'VISUAL_OVERLAP_CLIPPING':
    case 'CONTRAST_DEFECT':
    case 'UX_CONVERSION_FRICTION':
    case 'BROKEN_VISUAL_STATE':
      valid = hasScreenshot && text(finding.observed);
      break;
  }
  if (!valid)
    throw new Error(
      `Required proof for ${finding.rule_id} is missing or invalid`,
    );
}
