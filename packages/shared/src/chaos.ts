import Redis from 'ioredis';

/**
 * Chaos flags live in Redis so every service (and the web UI) shares them.
 * Layout: one hash per service, e.g. HSET chaos:orders health_fail 1
 */
export type ChaosFlags = Record<string, string>;

const CACHE_TTL_MS = 1000;

export class ChaosStore {
  private cache = new Map<string, { at: number; flags: ChaosFlags }>();

  constructor(private readonly redis: Redis) {}

  static fromEnv(): ChaosStore {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    return new ChaosStore(new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false }));
  }

  async get(service: string): Promise<ChaosFlags> {
    const hit = this.cache.get(service);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.flags;
    const flags = await this.redis.hgetall(`chaos:${service}`);
    this.cache.set(service, { at: Date.now(), flags });
    return flags;
  }

  async flag(service: string, key: string): Promise<string | undefined> {
    const flags = await this.get(service);
    return flags[key];
  }

  async set(service: string, key: string, value: string | null): Promise<void> {
    if (value === null || value === '' || value === '0' || value === 'off') {
      await this.redis.hdel(`chaos:${service}`, key);
    } else {
      await this.redis.hset(`chaos:${service}`, key, value);
    }
    this.cache.delete(service);
  }

  async reset(service?: string): Promise<void> {
    if (service) {
      await this.redis.del(`chaos:${service}`);
      this.cache.delete(service);
      return;
    }
    const keys = await this.redis.keys('chaos:*');
    if (keys.length) await this.redis.del(...keys);
    this.cache.clear();
  }

  async all(): Promise<Record<string, ChaosFlags>> {
    const keys = await this.redis.keys('chaos:*');
    const out: Record<string, ChaosFlags> = {};
    for (const key of keys) out[key.replace(/^chaos:/, '')] = await this.redis.hgetall(key);
    return out;
  }

  get client(): Redis {
    return this.redis;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function burnCpu(ms: number): number {
  const end = Date.now() + ms;
  let x = 0;
  while (Date.now() < end) {
    for (let i = 0; i < 1e5; i++) x = (x + Math.sqrt(i)) % 1e9;
  }
  return x;
}
