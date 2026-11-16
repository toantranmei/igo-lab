import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { sha256Hex } from './normalize';

export interface BlobStore {
  put(bytes: Uint8Array): Promise<string>;
  get(sha256: string): Promise<Uint8Array | null>;
  has(sha256: string): Promise<boolean>;
}

/** Content-addressed files on a local directory / Docker volume: <root>/blobs/<aa>/<sha256>. */
export class FsBlobStore implements BlobStore {
  constructor(private root: string) {}
  private file(sha: string) {
    if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('invalid blob id');
    return path.join(this.root, 'blobs', sha.slice(0, 2), sha);
  }
  async put(bytes: Uint8Array) {
    const sha = sha256Hex(bytes);
    const f = this.file(sha);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, bytes);
    return sha;
  }
  async get(sha: string) {
    try {
      return new Uint8Array(await readFile(this.file(sha)));
    } catch {
      return null;
    }
  }
  async has(sha: string) {
    try {
      await access(this.file(sha));
      return true;
    } catch {
      return false;
    }
  }
}

export function defaultBlobStore(): BlobStore {
  return new FsBlobStore(path.resolve(process.env.DATA_DIR ?? './data'));
}
