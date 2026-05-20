import { ProxyAgent } from "undici";
import { UnifiedChatRequest } from "../types/llm";

export function sendUnifiedRequest(
  url: URL | string,
  request: UnifiedChatRequest,
  config: any,
  context: any,
  logger?: any
): Promise<Response> {
  const headers = new Headers({
    "Content-Type": "application/json",
  });
  if (config.headers) {
    Object.entries(config.headers).forEach(([key, value]) => {
      if (value) {
        headers.set(key, value as string);
      }
    });
  }
  // AbortSignal.timeout() causes ERR_INVALID_THIS in Bun when fetch()
  // registers its own listener on the signal. Use AbortController +
  // setTimeout instead, which avoids that Bun-specific issue entirely.
  const controller = new AbortController();
  const timeoutMs = config.TIMEOUT ?? 60 * 1000 * 60;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (config.signal) {
    config.signal.addEventListener("abort", () => controller.abort());
  }

  const fetchOptions: RequestInit = {
    method: "POST",
    headers: headers,
    body: JSON.stringify(request),
    signal: controller.signal,
  };

  if (config.httpsProxy) {
    (fetchOptions as any).dispatcher = new ProxyAgent(
      new URL(config.httpsProxy).toString()
    );
  }
  logger?.debug(
    {
      reqId: context.req.id,
      // Exclude `signal` (AbortSignal): pino-redact's wildcard traversal
      // accesses AbortSignal.aborted getter which throws ERR_INVALID_THIS.
      request: { method: fetchOptions.method, bodyLength: (fetchOptions.body as string)?.length },
      headers: Object.fromEntries(headers.entries()),
      requestUrl: typeof url === "string" ? url : url.toString(),
      useProxy: config.httpsProxy,
    },
    "final request"
  );
  return fetch(typeof url === "string" ? url : url.toString(), fetchOptions)
    .finally(() => clearTimeout(timeoutId));
}
