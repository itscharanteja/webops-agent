import { describe, expect, it } from 'vitest';
import { fingerprint } from './fingerprint.js';

describe('issue fingerprint', () => {
  it('stays stable for a repeated rule and target, and separates different targets', () => {
    const page = 'https://example.com/catalog';
    const first = fingerprint(
      'BROKEN_INTERNAL_LINK',
      page,
      'https://example.com/missing',
    );
    expect(
      fingerprint('BROKEN_INTERNAL_LINK', page, 'https://example.com/missing'),
    ).toBe(first);
    expect(
      fingerprint('BROKEN_INTERNAL_LINK', page, 'https://example.com/other'),
    ).not.toBe(first);
    expect(
      fingerprint('HTTP_PAGE_ERROR', page, 'https://example.com/missing'),
    ).not.toBe(first);
  });
});
