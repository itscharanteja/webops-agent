import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const localDir = path.resolve(root, process.env.ARTIFACT_DIR ?? '.artifacts');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'webops-proofs';

export class ArtifactStore {
  private valid(key: string, scanId: string): boolean {
    return new RegExp(`^${scanId}/[0-9a-f-]{36}\\.(jpg|png)$`).test(key);
  }

  async signedUrl(key: string, scanId: string): Promise<string | null> {
    if (!this.valid(key, scanId) || !serviceKey || !supabaseUrl) return null;
    const response = await fetch(
      `${supabaseUrl}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${key}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 60 }),
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      signedURL?: string;
      signedUrl?: string;
    };
    const signed = body.signedURL ?? body.signedUrl;
    if (!signed) return null;
    if (/^https:\/\//.test(signed)) return signed;
    const relative = signed.startsWith('/storage/v1/')
      ? signed
      : `/storage/v1/${signed.replace(/^\//, '')}`;
    return new URL(relative, supabaseUrl).toString();
  }

  async readLocal(
    key: string,
    scanId: string,
    checksum: string,
  ): Promise<Buffer | null> {
    if (!this.valid(key, scanId) || serviceKey) return null;
    try {
      const bytes = await readFile(path.join(localDir, key));
      if (createHash('sha256').update(bytes).digest('hex') !== checksum)
        return null;
      return bytes;
    } catch {
      return null;
    }
  }
}
