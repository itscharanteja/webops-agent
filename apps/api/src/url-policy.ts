import { resolve4, resolve6 } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyError';
  }
}

export type Resolver = (hostname: string) => Promise<string[]>;

export const systemResolver: Resolver = async (hostname) => {
  const answers = await Promise.allSettled([
    resolve4(hostname),
    resolve6(hostname),
  ]);
  const addresses = answers.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : [],
  );
  if (addresses.length === 0) throw new PolicyError('Host does not resolve');
  return addresses;
};

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    const effective =
      parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()
        ? parsed.toIPv4Address()
        : parsed;
    return effective.range() === 'unicast';
  } catch {
    return false;
  }
}

function parseHttpUrl(raw: string): URL {
  if (/[\\\u0000-\u001f\u007f]/.test(raw) || raw.trim() !== raw)
    throw new PolicyError('Invalid URL characters');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PolicyError('Invalid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new PolicyError('Only HTTP(S) is allowed');
  if (url.username || url.password || raw.includes('@'))
    throw new PolicyError('Credentials in URLs are not allowed');
  const localFixture =
    process.env.NODE_ENV !== 'production' &&
    url.origin === process.env.WEBOPS_LOCAL_FIXTURE_ORIGIN;
  if (
    url.port &&
    !(
      (url.protocol === 'http:' && url.port === '80') ||
      (url.protocol === 'https:' && url.port === '443')
    )
  ) {
    // The local fixture exception is bound to one exact origin and never enabled in production.
    if (!localFixture) {
      throw new PolicyError('Unexpected port');
    }
  }
  if (
    !localFixture &&
    (!url.hostname.includes('.') ||
      url.hostname.endsWith('.local') ||
      url.hostname.endsWith('.internal'))
  ) {
    throw new PolicyError('Non-public hostname');
  }
  if (!localFixture && isIP(url.hostname) !== 0)
    throw new PolicyError('IP literals are not allowed');
  url.hash = '';
  return url;
}

export async function validatePublicUrl(
  raw: string,
  resolver: Resolver = systemResolver,
): Promise<string> {
  const url = parseHttpUrl(raw);
  if (
    process.env.NODE_ENV !== 'production' &&
    url.origin === process.env.WEBOPS_LOCAL_FIXTURE_ORIGIN
  )
    return url.href;
  const addresses = await resolver(url.hostname);
  if (
    addresses.length === 0 ||
    addresses.some((address) => !isPublicAddress(address))
  ) {
    throw new PolicyError('Host resolves to a blocked address');
  }
  return url.href;
}

export async function validateApprovedOrigins(
  baseUrl: string,
  origins: string[],
  resolver: Resolver = systemResolver,
) {
  if (new URL(baseUrl).search)
    throw new PolicyError('Base URL must not contain a query');
  const normalizedBaseUrl = await validatePublicUrl(baseUrl, resolver);
  const normalizedOrigins = await Promise.all(
    origins.map(async (raw) => {
      const parsed = new URL(raw);
      if (parsed.pathname !== '/' || parsed.search || parsed.hash)
        throw new PolicyError(
          'Approved origins must not contain a path, query, or fragment',
        );
      return new URL(await validatePublicUrl(raw, resolver)).origin;
    }),
  );
  const unique = [...new Set(normalizedOrigins)];
  if (unique.length !== origins.length)
    throw new PolicyError('Duplicate approved origin');
  if (!unique.includes(new URL(normalizedBaseUrl).origin))
    throw new PolicyError('Base URL origin must be approved');
  return { baseUrl: normalizedBaseUrl, approvedOrigins: unique };
}
