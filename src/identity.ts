import { createHash, randomInt, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function isClientId(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+$/.test(value);
}

/** Main owns one identity per stream, collector partition and application identity key. */
export class IdentityStore {
  private readonly identities = new Map<string, string>();
  private readonly persisted = new Map<string, boolean>();

  constructor(
    private readonly directory: string,
    private readonly scope: string,
    private readonly onError: () => void,
  ) {}

  get status(): 'unused' | 'persisted' | 'memory' {
    if (!this.persisted.size) return 'unused';
    return [...this.persisted.values()].every(Boolean) ? 'persisted' : 'memory';
  }

  private path(key: string): string {
    const name = createHash('sha256').update(JSON.stringify([this.scope, key])).digest('hex');
    return join(this.directory, `${name}.json`);
  }

  get(key: string): string | undefined {
    const cached = this.identities.get(key);
    if (cached) return cached;
    try {
      const saved: unknown = JSON.parse(readFileSync(this.path(key), 'utf8'));
      if (!saved || typeof saved !== 'object' || !('clientId' in saved) || !isClientId(saved.clientId)) {
        throw new Error('Invalid anonymous identity');
      }
      this.identities.set(key, saved.clientId);
      this.persisted.set(key, true);
      return saved.clientId;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.onError();
      return undefined;
    }
  }

  resolve(key: string, legacy?: unknown): string {
    return this.get(key) ?? this.set(key, isClientId(legacy) ? legacy :
      `${randomInt(1, 0x100000000)}.${Math.floor(Date.now() / 1000)}`);
  }

  set(key: string, clientId: string): string {
    if (!isClientId(clientId)) throw new Error('Invalid anonymous identity');
    if (this.identities.get(key) === clientId && this.persisted.get(key)) return clientId;
    this.identities.set(key, clientId);
    let temporary: string | undefined;
    let descriptor: number | undefined;
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const path = this.path(key);
      temporary = `${path}.${randomUUID()}.tmp`;
      descriptor = openSync(temporary, 'wx', 0o600);
      writeFileSync(descriptor, JSON.stringify({ clientId }), 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, path);
      this.persisted.set(key, true);
    } catch {
      this.persisted.set(key, false);
      this.onError();
    } finally {
      if (descriptor !== undefined) { try { closeSync(descriptor); } catch { /* Best effort. */ } }
      if (temporary) { try { unlinkSync(temporary); } catch { /* Renamed or not created. */ } }
    }
    return clientId;
  }
}
