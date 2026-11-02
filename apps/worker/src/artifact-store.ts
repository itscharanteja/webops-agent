import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const localDir = path.resolve(root, process.env.ARTIFACT_DIR ?? '.artifacts');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'webops-proofs';

export type StoredArtifact = {
  objectKey: string;
  checksum: string;
  mimeType: string;
};

export class ArtifactStore {
  async put(
    scanId: string,
    base64: string,
    mimeType: 'image/jpeg' | 'image/png',
  ): Promise<StoredArtifact> {
    const bytes = Buffer.from(base64, 'base64');
    if (
      bytes.length === 0 ||
      bytes.length > 600_000 ||
      bytes.toString('base64') !== base64
    )
      throw new Error('Invalid or oversized screenshot artifact');
    const jpeg =
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff;
    const png = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (mimeType === 'image/jpeg' ? !jpeg : !png)
      throw new Error('Screenshot artifact signature is invalid');
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const objectKey = `${scanId}/${randomUUID()}.${mimeType === 'image/jpeg' ? 'jpg' : 'png'}`;
    if (serviceKey && supabaseUrl) {
      const url = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${objectKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          'content-type': mimeType,
          'x-upsert': 'false',
        },
        body: bytes,
      });
      if (!response.ok)
        throw new Error(`Private artifact upload failed (${response.status})`);
    } else {
      const destination = path.join(localDir, objectKey);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      const file = await open(destination, 'wx', 0o600);
      try {
        await file.writeFile(bytes);
      } finally {
        await file.close();
      }
    }
    return { objectKey, checksum, mimeType };
  }

  async remove(objectKey: string): Promise<void> {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png)$/.test(objectKey)) return;
    if (serviceKey && supabaseUrl) {
      await fetch(
        `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${objectKey}`,
        {
          method: 'DELETE',
          headers: {
            authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
          },
        },
      ).catch(() => undefined);
    } else {
      await unlink(path.join(localDir, objectKey)).catch(() => undefined);
    }
  }
}
