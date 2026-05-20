import { createHash } from "crypto";
import IORedis from "ioredis";

let client: IORedis | null = null;
let warnedOnce = false;

function getClient(): IORedis | null {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  client = new IORedis(url, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    lazyConnect: true,
  }).on("error", (err: unknown) => {
    if (!warnedOnce) {
      warnedOnce = true;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[response-cache] Redis unavailable: ${msg}`);
    }
  });
  return client;
}

const PREFIX = "ccr:resp:";

export function hashRequest(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

interface CacheEntry {
  contentType: string;
  body: string;
}

export async function cacheGet(key: string): Promise<CacheEntry | null> {
  try {
    const raw = await getClient()?.get(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

export async function cacheSet(
  key: string,
  entry: CacheEntry,
  ttlSec: number
): Promise<void> {
  try {
    await getClient()?.set(PREFIX + key, JSON.stringify(entry), "EX", ttlSec);
  } catch {}
}
