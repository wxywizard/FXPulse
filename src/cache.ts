export interface EdgeCachePolicy {
  freshSeconds: number;
  staleSeconds: number;
}

type EdgeCache = Pick<Cache, "match" | "put">;

const CACHE_CREATED_HEADER = "x-fxpulse-cache-created";
const CACHE_STATUS_HEADER = "x-fxpulse-cache";
const CACHE_SCHEMA_VERSION = "free-tier-v1";

export async function withEdgeCache(
  request: Request,
  ctx: ExecutionContext,
  policy: EdgeCachePolicy,
  loader: () => Promise<Response>,
  cacheOverride?: EdgeCache | null,
  nowEpoch = Math.floor(Date.now() / 1000),
): Promise<Response> {
  if (request.method !== "GET") return loader();
  const cache = cacheOverride === undefined ? defaultEdgeCache() : cacheOverride;
  if (!cache) return loader();

  const cacheKey = normalizedCacheKey(request);
  const cached = await cache.match(cacheKey);
  if (cached) {
    const createdAt = Number(cached.headers.get(CACHE_CREATED_HEADER));
    const ageSeconds = Number.isFinite(createdAt)
      ? Math.max(0, nowEpoch - createdAt)
      : policy.freshSeconds + 1;
    if (ageSeconds <= policy.freshSeconds) {
      return visibleCachedResponse(cached, "HIT", policy);
    }

    ctx.waitUntil(refreshCache(cache, cacheKey, policy, loader, nowEpoch));
    return visibleCachedResponse(cached, "STALE", policy);
  }

  const response = await loader();
  if (response.ok) {
    ctx.waitUntil(storeCachedResponse(cache, cacheKey, response.clone(), policy, nowEpoch));
  }
  return withCacheStatus(response, "MISS");
}

async function refreshCache(
  cache: EdgeCache,
  cacheKey: Request,
  policy: EdgeCachePolicy,
  loader: () => Promise<Response>,
  nowEpoch: number,
): Promise<void> {
  try {
    const response = await loader();
    if (response.ok) {
      await storeCachedResponse(cache, cacheKey, response, policy, nowEpoch);
    }
  } catch (error) {
    console.warn("Edge cache background refresh skipped", error);
  }
}

async function storeCachedResponse(
  cache: EdgeCache,
  cacheKey: Request,
  response: Response,
  policy: EdgeCachePolicy,
  nowEpoch: number,
): Promise<void> {
  const headers = new Headers(response.headers);
  headers.set(CACHE_CREATED_HEADER, String(nowEpoch));
  headers.set("cache-control", `public, max-age=${policy.staleSeconds}`);
  await cache.put(cacheKey, new Response(response.body, { status: response.status, headers }));
}

function visibleCachedResponse(
  response: Response,
  status: "HIT" | "STALE",
  policy: EdgeCachePolicy,
): Response {
  const headers = new Headers(response.headers);
  headers.delete(CACHE_CREATED_HEADER);
  headers.set(CACHE_STATUS_HEADER, status);
  headers.set(
    "cache-control",
    `public, max-age=30, s-maxage=${policy.freshSeconds}, stale-while-revalidate=${policy.staleSeconds}`,
  );
  return new Response(response.body, { status: response.status, headers });
}

function withCacheStatus(response: Response, status: "MISS"): Response {
  const headers = new Headers(response.headers);
  headers.set(CACHE_STATUS_HEADER, status);
  return new Response(response.body, { status: response.status, headers });
}

function normalizedCacheKey(request: Request): Request {
  const url = new URL(request.url);
  url.searchParams.delete("v");
  url.searchParams.set("__fxpulse_cache", CACHE_SCHEMA_VERSION);
  url.searchParams.sort();
  return new Request(url.toString(), { method: "GET" });
}

function defaultEdgeCache(): EdgeCache | null {
  try {
    return typeof caches === "undefined" ? null : caches.default;
  } catch {
    return null;
  }
}
