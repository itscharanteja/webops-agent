import { afterEach, describe, expect, it } from 'vitest';
import {
  isPublicAddress,
  validateApprovedOrigins,
  validatePublicUrl,
  type Resolver,
} from './url-policy.js';

const publicResolver: Resolver = async () => [
  '93.184.215.14',
  '2606:2800:220:1:248:1893:25c8:1946',
];
afterEach(() => {
  delete process.env.WEBOPS_LOCAL_FIXTURE_ORIGIN;
});

describe('public URL policy', () => {
  it('canonicalizes a URL and accepts only its exact approved origin', async () => {
    expect(
      await validateApprovedOrigins(
        'https://EXAMPLE.com:443/a#section',
        ['https://example.com'],
        publicResolver,
      ),
    ).toEqual({
      baseUrl: 'https://example.com/a',
      approvedOrigins: ['https://example.com'],
    });
    await expect(
      validateApprovedOrigins(
        'https://example.com',
        ['https://other.example'],
        publicResolver,
      ),
    ).rejects.toThrow('Base URL origin');
    await expect(
      validateApprovedOrigins(
        'https://example.com',
        ['https://example.com/path'],
        publicResolver,
      ),
    ).rejects.toThrow('must not contain');
    await expect(
      validateApprovedOrigins(
        'https://example.com/?token=secret',
        ['https://example.com'],
        publicResolver,
      ),
    ).rejects.toThrow('must not contain a query');
  });

  it.each([
    'http://localhost/',
    'http://127.0.0.1/',
    'http://127.1/',
    'http://0x7f000001/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[fe80::1]/',
    'file:///etc/passwd',
    'http://user:pass@example.com/',
    'https://example.com:8443/',
    'http://example.com\\@evil.example/',
  ])('rejects blocked or ambiguous URL %s', async (raw) => {
    await expect(validatePublicUrl(raw, publicResolver)).rejects.toThrow();
  });

  it('fails closed when any DNS answer is private or DNS fails', async () => {
    await expect(
      validatePublicUrl('https://example.com', async () => [
        '93.184.215.14',
        '10.1.2.3',
      ]),
    ).rejects.toThrow('blocked address');
    await expect(
      validatePublicUrl('https://example.com', async () => []),
    ).rejects.toThrow('blocked address');
    await expect(
      validatePublicUrl('https://example.com', async () => {
        throw new Error('DNS failed');
      }),
    ).rejects.toThrow('DNS failed');
  });

  it('classifies reserved, mapped and metadata addresses as blocked', () => {
    for (const address of [
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '100.100.100.200',
      '169.254.169.254',
      '::1',
      'fc00::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('permits only the exact local fixture origin in non-production mode', async () => {
    process.env.WEBOPS_LOCAL_FIXTURE_ORIGIN = 'http://localhost:8080';
    expect(await validatePublicUrl('http://localhost:8080/index.html')).toBe(
      'http://localhost:8080/index.html',
    );
    await expect(validatePublicUrl('http://localhost:8081/')).rejects.toThrow();
    await expect(validatePublicUrl('http://127.0.0.1:8080/')).rejects.toThrow();
  });
});
