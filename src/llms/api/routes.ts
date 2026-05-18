import {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import { RegisterProviderRequest, LLMProvider } from "@/llms/types/llm";
import { sendUnifiedRequest } from "@/llms/utils/request";
import { cacheGet, cacheSet, hashRequest } from "@/llms/utils/responseCache";
import { createApiError } from "./middleware";
import { version } from "../../../package.json";
import { ConfigService } from "@/llms/services/config";
import { ProviderService } from "@/llms/services/provider";
import { TransformerService } from "@/llms/services/transformer";
import { Transformer } from "@/llms/types/transformer";
import { randomUUID } from "crypto";
import { getPrismaClient } from "@/db/client";

// Extend FastifyInstance to include custom services
declare module "fastify" {
  interface FastifyInstance {
    configService: ConfigService;
    providerService: ProviderService;
    transformerService: TransformerService;
  }

  interface FastifyRequest {
    provider?: string;
  }
}

/**
 * Main handler for transformer endpoints
 * Coordinates the entire request processing flow: validate provider, handle request transformers,
 * send request, handle response transformers, format response
 */
export async function handleTransformerEndpoint(
  req: FastifyRequest,
  reply: FastifyReply,
  fastify: FastifyInstance,
  transformer: any
) {
  const body = req.body as any;
  const providerName = req.provider!;
  const provider = fastify.providerService.getProvider(providerName);

  // Validate provider exists
  if (!provider) {
    throw createApiError(
      `Provider '${providerName}' not found`,
      404,
      "provider_not_found"
    );
  }

  // Provider-level response cache (opt-in: set transformer.response_cache_ttl
  // in the provider config). Cache key is computed from the original body
  // BEFORE transformers. The cached value is the FINAL (already-transformed)
  // response so it can be returned verbatim without re-running the pipeline.
  const rawProviders = (fastify.configService?.get?.("providers") ?? []) as any[];
  const rawProvider = rawProviders.find((p: any) => p.name === providerName);
  const cacheTtl = Number(rawProvider?.transformer?.response_cache_ttl || 0);
  const cacheKey = cacheTtl > 0 ? hashRequest(body) : null;

  try {
    if (cacheKey) {
      const hit = await cacheGet(cacheKey);
      if (hit) {
        const log = (fastify.log ?? console) as any;
        log.debug?.(
          { type: "response", provider: provider.name, model: body?.model, fromCache: true },
          `${provider.name}/${body?.model} (cached)`
        );
        return formatResponse(
          new Response(hit.body, { status: 200, headers: { "content-type": hit.contentType } }),
          reply,
          body
        );
      }
    }

    // Process request transformer chain
    const { requestBody, config, bypass } = await processRequestTransformers(
      body,
      provider,
      transformer,
      req.headers,
      {
        req,
      }
    );

    // Send request to LLM provider
    const response = await sendRequestToProvider(
      requestBody,
      config,
      provider,
      fastify,
      bypass,
      transformer,
      {
        req,
      }
    );

    // Process response transformer chain
    const finalResponse = await processResponseTransformers(
      requestBody,
      response,
      provider,
      transformer,
      bypass,
      {
        req,
      }
    );

    // Populate cache with the fully-transformed response so cache hits
    // can be returned directly without re-running the pipeline.
    if (cacheKey && typeof finalResponse?.clone === "function") {
      void finalResponse.clone().text().then((text) => {
        const ct = finalResponse.headers?.get?.("content-type") || "text/event-stream";
        void cacheSet(cacheKey, { contentType: ct, body: text }, cacheTtl);
      });
    }

    // Format and return response
    return formatResponse(finalResponse, reply, body);
  } catch (error: any) {
    // Handle fallback if error occurs
    if (error.code === 'provider_response_error') {
      const fallbackResult = await handleFallback(req, reply, fastify, transformer, error);
      if (fallbackResult) {
        return fallbackResult;
      }
    }
    throw error;
  }
}

/**
 * Handle fallback logic when request fails
 * Tries each fallback model in sequence until one succeeds
 */
async function handleFallback(
  req: FastifyRequest,
  reply: FastifyReply,
  fastify: FastifyInstance,
  transformer: any,
  error: any
): Promise<any> {
  const scenarioType = (req as any).scenarioType || 'default';
  const fallbackConfig = fastify.configService.get<any>('fallback');

  if (!fallbackConfig || !fallbackConfig[scenarioType]) {
    return null;
  }

  const fallbackList = fallbackConfig[scenarioType] as string[];
  if (!Array.isArray(fallbackList) || fallbackList.length === 0) {
    return null;
  }

  req.log.warn(`Request failed for ${(req as any).scenarioType}, trying ${fallbackList.length} fallback models`);

  // Try each fallback model in sequence
  for (const fallbackModel of fallbackList) {
    try {
      req.log.info(`Trying fallback model: ${fallbackModel}`);

      // Update request with fallback model
      const newBody = { ...(req.body as any) };
      const [fallbackProvider, ...fallbackModelName] = fallbackModel.split(',');
      newBody.model = fallbackModelName.join(',');

      // Create new request object with updated provider and body
      const newReq = {
        ...req,
        provider: fallbackProvider,
        body: newBody,
      };

      const provider = fastify.providerService.getProvider(fallbackProvider);
      if (!provider) {
        req.log.warn(`Fallback provider '${fallbackProvider}' not found, skipping`);
        continue;
      }

      // Process request transformer chain
      const { requestBody, config, bypass } = await processRequestTransformers(
        newBody,
        provider,
        transformer,
        req.headers,
        { req: newReq }
      );

      // Send request to LLM provider
      const response = await sendRequestToProvider(
        requestBody,
        config,
        provider,
        fastify,
        bypass,
        transformer,
        { req: newReq }
      );

      // Process response transformer chain
      const finalResponse = await processResponseTransformers(
        requestBody,
        response,
        provider,
        transformer,
        bypass,
        { req: newReq }
      );

      req.log.info(`Fallback model ${fallbackModel} succeeded`);

      // Format and return response
      return formatResponse(finalResponse, reply, newBody);
    } catch (fallbackError: any) {
      req.log.warn(`Fallback model ${fallbackModel} failed: ${fallbackError.message}`);
      continue;
    }
  }

  req.log.error(`All fallback models failed for yichu ${scenarioType}`);
  return null;
}

/**
 * Process request transformer chain
 * Sequentially execute transformRequestOut, provider transformers, model-specific transformers
 * Returns processed request body, config, and flag indicating whether to skip transformers
 */
async function processRequestTransformers(
  body: any,
  provider: any,
  transformer: any,
  headers: any,
  context: any
) {
  let requestBody = body;
  let config: any = {};
  let bypass = false;

  // Check if transformers should be bypassed (passthrough mode)
  bypass = shouldBypassTransformers(provider, transformer, body);

  if (bypass) {
    if (headers instanceof Headers) {
      headers.delete("content-length");
    } else {
      delete headers["content-length"];
    }
    config.headers = headers;
  }

  // Execute transformer's transformRequestOut method
  if (!bypass && typeof transformer.transformRequestOut === "function") {
    const transformOut = await transformer.transformRequestOut(requestBody);
    if (transformOut.body) {
      requestBody = transformOut.body;
      config = transformOut.config || {};
    } else {
      requestBody = transformOut;
    }
  }

  // Execute provider-level transformers
  if (!bypass && provider.transformer?.use?.length) {
    for (const providerTransformer of provider.transformer.use) {
      if (
        !providerTransformer ||
        typeof providerTransformer.transformRequestIn !== "function"
      ) {
        continue;
      }
      const transformIn = await providerTransformer.transformRequestIn(
        requestBody,
        provider,
        context
      );
      if (transformIn.body) {
        requestBody = transformIn.body;
        config = { ...config, ...transformIn.config };
      } else {
        requestBody = transformIn;
      }
    }
  }

  // Execute model-specific transformers
  if (!bypass && provider.transformer?.[body.model]?.use?.length) {
    for (const modelTransformer of provider.transformer[body.model].use) {
      if (
        !modelTransformer ||
        typeof modelTransformer.transformRequestIn !== "function"
      ) {
        continue;
      }
      requestBody = await modelTransformer.transformRequestIn(
        requestBody,
        provider,
        context
      );
    }
  }

  return { requestBody, config, bypass };
}

/**
 * Determine if transformers should be bypassed (passthrough mode)
 * Skip other transformers when provider only uses one transformer and it matches the current one
 */
function shouldBypassTransformers(
  provider: any,
  transformer: any,
  body: any
): boolean {
  return (
    provider.transformer?.use?.length === 1 &&
    provider.transformer.use[0].name === transformer.name &&
    (!provider.transformer?.[body.model]?.use.length ||
      (provider.transformer?.[body.model]?.use.length === 1 &&
        provider.transformer?.[body.model]?.use[0].name === transformer.name))
  );
}

// Best-effort token-usage extraction from a *cloned* response so the
// completion log can report usage + cache without touching the stream
// the client consumes. Covers:
//  - Non-stream JSON: top-level `.usage`
//  - Anthropic SSE: message_start (input_tokens + cache_*), message_delta (output_tokens)
//  - OpenAI Responses API SSE: response.completed carries response.usage
//  - OpenAI chat completions SSE: last chunk may carry top-level usage
// Never throws.
async function extractResponseUsage(resp: any): Promise<any | null> {
  try {
    const ct = (resp.headers?.get?.("content-type") || "").toLowerCase();
    // Explicit JSON response — parse directly.
    if (ct.includes("application/json")) {
      const j = await resp.json().catch(() => null);
      return j?.usage ?? null;
    }
    // For SSE (text/event-stream) or unknown content-type (e.g. the codex
    // backend streams SSE without setting content-type), parse as SSE.
    // Falls back to JSON if no SSE usage events are found.
    const text = await resp.text();
    let usage: any = null;
    for (const block of text.split("\n\n")) {
      const dataLine = block
        .split("\n")
        .find((l: string) => l.startsWith("data:"));
      if (!dataLine) continue;
      const raw = dataLine.slice(5).trim();
      if (raw === "[DONE]") continue;
      let obj: any;
      try {
        obj = JSON.parse(raw);
      } catch {
        continue;
      }
      // Anthropic SSE
      if (obj?.type === "message_start" && obj.message?.usage) {
        usage = { ...obj.message.usage };
      } else if (obj?.type === "message_delta" && obj.usage) {
        usage = { ...(usage || {}), ...obj.usage };
      }
      // OpenAI Responses API SSE
      else if (obj?.type === "response.completed" && obj.response?.usage) {
        usage = { ...obj.response.usage };
      }
      // OpenAI chat completions SSE (usage in last chunk)
      else if (obj?.usage && typeof obj.usage.prompt_tokens === "number") {
        usage = { ...obj.usage };
      }
    }
    // JSON fallback: if SSE parsing found nothing but the body is JSON.
    if (!usage) {
      try {
        const j = JSON.parse(text);
        if (j?.usage) usage = j.usage;
      } catch {}
    }
    return usage;
  } catch {
    return null;
  }
}

/**
 * Send request to LLM provider
 * Handle authentication, build request config, send request and handle errors
 */
async function sendRequestToProvider(
  requestBody: any,
  config: any,
  provider: any,
  fastify: FastifyInstance,
  bypass: boolean,
  transformer: any,
  context: any
) {
  const url = config.url || new URL(provider.baseUrl);

  // One id per upstream send. LogViewer groups a request's lines by
  // `reqId`, so binding it on a child logger ties the "llm request"
  // metadata to its "llm response"/error line. Generated here (the
  // pipeline has no ambient request id), so a fallback/retry that
  // re-enters this function is its own visible attempt.
  const reqId = randomUUID();
  const reqLog =
    fastify.log && typeof fastify.log.child === "function"
      ? fastify.log.child({ reqId })
      : fastify.log;

  // Codex sends `thread_id`; Claude Code sends `x-claude-code-session-id`.
  const h = context.req?.headers || {};
  const sessionId: string =
    (typeof h['thread_id'] === 'string' ? h['thread_id'] : null) ||
    (typeof h['x-claude-code-session-id'] === 'string' ? h['x-claude-code-session-id'] : null) ||
    crypto.randomUUID();
  const startedAt = Date.now();

  // Metadata only — never the prompt/response bodies. `type: 'request
  // body'` + `data.model` is the shape LogViewer reads the model from.
  reqLog.debug(
    {
      type: "request body",
      data: {
        provider: provider.name,
        model: requestBody?.model,
        url: String(url),
        stream: requestBody?.stream === true,
        bypass,
        messages: Array.isArray(requestBody?.messages)
          ? requestBody.messages.length
          : undefined,
        tools: Array.isArray(requestBody?.tools)
          ? requestBody.tools.length
          : undefined,
      },
    },
    "llm request"
  );

  // Handle authentication in passthrough mode
  if (bypass && typeof transformer.auth === "function") {
    const auth = await transformer.auth(requestBody, provider);
    if (auth.body) {
      requestBody = auth.body;
      let headers = config.headers || {};
      if (auth.config?.headers) {
        // The client authenticated to THIS proxy (x-api-key or
        // Authorization: Bearer <gateway key>). Drop every case variant
        // before merging the transformer's upstream auth — otherwise the
        // inbound lowercase `authorization` survives alongside the
        // capitalized one and, because Headers.set() is case-insensitive,
        // the gateway key overwrites the OAuth bearer and 401s upstream.
        for (const k of Object.keys(headers)) {
          const lk = k.toLowerCase();
          if (lk === "authorization" || lk === "x-api-key") delete headers[k];
        }
        headers = {
          ...headers,
          ...auth.config.headers,
        };
        delete headers.host;
        delete auth.config.headers;
      }
      config = {
        ...config,
        ...auth.config,
        headers,
      };
    } else {
      requestBody = auth;
    }
  }

  // Send HTTP request
  // Prepare headers
  const requestHeaders: Record<string, string> = {
    Authorization: `Bearer ${provider.apiKey}`,
    ...(config?.headers || {}),
  };

  for (const key in requestHeaders) {
    if (requestHeaders[key] === "undefined") {
      delete requestHeaders[key];
    } else if (
      ["authorization", "Authorization"].includes(key) &&
      requestHeaders[key]?.includes("undefined")
    ) {
      delete requestHeaders[key];
    }
  }

  const response = await sendUnifiedRequest(
    url,
    requestBody,
    {
      httpsProxy: fastify.configService.getHttpsProxy(),
      ...config,
      headers: JSON.parse(JSON.stringify(requestHeaders)),
    },
    context,
    fastify.log
  );

  const durationMs = Date.now() - startedAt;

  // Handle request errors
  if (!response.ok) {
    const errorText = await response.text();
    const isSubscription =
      typeof transformer?.name === "string" &&
      transformer.name.endsWith("-oauth");
    // Keep this message byte-for-byte: v1Route's PROVIDER_ERR_RE parses
    // exactly "Error from provider(<name>,<model>: <status>): <rawBody>"
    // to forward the genuine upstream error to Claude Code verbatim.
    const message = `Error from provider(${provider.name},${requestBody.model}: ${response.status}): ${errorText}`;
    reqLog.error(
      {
        type: "response",
        provider: provider.name,
        model: requestBody?.model,
        status: response.status,
        durationMs,
        body: errorText,
      },
      `[provider_response_error] ${message}`
    );
    // A 401/403 from a subscription (*-oauth) provider is an
    // upstream auth rejection. Don't assert a single cause: it can be
    // absent/expired OAuth creds OR the request reaching the provider
    // with the wrong bearer (e.g. an inbound gateway credential leaking
    // upstream). The credentials file is re-read per request, so no
    // `ccr restart` is needed after re-auth.
    if (
      (response.status === 401 || response.status === 403) &&
      isSubscription
    ) {
      reqLog.error(
        { provider: provider.name, status: response.status },
        `Subscription auth rejected by '${provider.name}' (${response.status}). ` +
          "If the OAuth credentials are absent/expired, re-authenticate " +
          "the underlying CLI (run `claude` and sign in for claude-code, " +
          "or `codex login` for codex) to refresh the credentials file " +
          "(re-read per request, no `ccr restart` needed)."
      );
    }
    throw createApiError(message, response.status, "provider_response_error");
  }

  // Log the response immediately so it always appears in the log even
  // before the stream is fully consumed. Usage is extracted from a clone
  // asynchronously and logged separately once the stream ends.
  const baseLog = {
    type: "response",
    provider: provider.name,
    model: requestBody?.model,
    status: response.status,
    durationMs,
  };
  reqLog.debug(
    baseLog,
    `${provider.name}/${requestBody?.model} ${response.status} ${durationMs}ms`
  );

  const usageProbe =
    typeof response.clone === "function" ? response.clone() : null;
  if (usageProbe) {
    void extractResponseUsage(usageProbe).then((usage) => {
      if (usage) {
        // Anthropic: cache_read_input_tokens / cache_creation_input_tokens
        // OpenAI:    input_tokens_details.cached_tokens
        // Anthropic: cache_read_input_tokens / cache_creation_input_tokens
        // OpenAI:    input_tokens_details.cached_tokens
        const cachedTokens =
          Number(usage.cache_read_input_tokens || 0) ||
          Number(usage.input_tokens_details?.cached_tokens || 0);
        const writtenTokens = Number(usage.cache_creation_input_tokens || 0);
        const outputTokens =
          Number(usage.output_tokens || 0) ||
          Number(usage.completion_tokens || 0);
        // For Anthropic, input_tokens is only the non-cached portion.
        // Total = input + cache_creation + cache_read.
        const rawInput =
          Number(usage.input_tokens || 0) ||
          Number(usage.prompt_tokens || 0);
        const totalInputTokens = rawInput + writtenTokens + cachedTokens;
        const cacheHitPct =
          totalInputTokens > 0
            ? Math.round((cachedTokens / totalInputTokens) * 100)
            : 0;
        reqLog.debug(
          {
            ...baseLog,
            usage,
            cacheRead: cachedTokens > 0,
            cacheWrite: writtenTokens > 0,
            cacheHitPct,
          },
          `${provider.name}/${requestBody?.model} in=${totalInputTokens} out=${outputTokens} cache=${cacheHitPct}%`
        );
        const prisma = getPrismaClient();
        const writeLog = async () => {
          await prisma.session.upsert({
            where: { id: sessionId },
            create: { id: sessionId },
            update: { updatedAt: new Date() },
          });
          await prisma.requestLog.create({
            data: {
              sessionId,
              provider: provider.name,
              model: requestBody?.model ?? 'unknown',
              inputTokens: rawInput,
              outputTokens,
              cacheReadTokens: cachedTokens,
              cacheWriteTokens: writtenTokens,
              totalInputTokens,
              cacheHitPct,
              durationMs,
              status: response.status,
            },
          });
        };
        void writeLog().catch(() => {});
      }
    });
  }

  return response;
}

/**
 * Process response transformer chain
 * Sequentially execute provider transformers, model-specific transformers, transformer's transformResponseIn
 */
async function processResponseTransformers(
  requestBody: any,
  response: any,
  provider: any,
  transformer: any,
  bypass: boolean,
  context: any
) {
  let finalResponse = response;

  // Execute provider-level response transformers
  if (!bypass && provider.transformer?.use?.length) {
    for (const providerTransformer of Array.from(
      provider.transformer.use
    ).reverse() as Transformer[]) {
      if (
        !providerTransformer ||
        typeof providerTransformer.transformResponseOut !== "function"
      ) {
        continue;
      }
      finalResponse = await providerTransformer.transformResponseOut!(
        finalResponse,
        context
      );
    }
  }

  // Execute model-specific response transformers
  if (!bypass && provider.transformer?.[requestBody.model]?.use?.length) {
    for (const modelTransformer of Array.from(
      provider.transformer[requestBody.model].use
    ).reverse() as Transformer[]) {
      if (
        !modelTransformer ||
        typeof modelTransformer.transformResponseOut !== "function"
      ) {
        continue;
      }
      finalResponse = await modelTransformer.transformResponseOut!(
        finalResponse,
        context
      );
    }
  }

  // Execute transformer's transformResponseIn method
  if (!bypass && transformer.transformResponseIn) {
    finalResponse = await transformer.transformResponseIn(
      finalResponse,
      context
    );
  }

  return finalResponse;
}

/**
 * Format and return response
 * Handle HTTP status codes, format streaming and regular responses
 */
function formatResponse(response: any, reply: FastifyReply, body: any) {
  // Set HTTP status code
  if (!response.ok) {
    reply.code(response.status);
  }

  // Handle streaming response
  const isStream = body.stream === true;
  if (isStream) {
    reply.header("Content-Type", "text/event-stream");
    reply.header("Cache-Control", "no-cache");
    reply.header("Connection", "keep-alive");
    return reply.send(response.body);
  } else {
    // Handle regular JSON response
    return response.json();
  }
}

export const registerApiRoutes = async (
  fastify: FastifyInstance
) => {
  // Health and info endpoints
  fastify.get("/", async () => {
    return { message: "LLMs API", version };
  });

  fastify.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  const transformersWithEndpoint =
    fastify.transformerService.getTransformersWithEndpoint();

  // Group by endpoint path so duplicate endpoints register only one route
  const endpointTransformerMap = new Map<string, Map<string, any>>();
  for (const { name, transformer } of transformersWithEndpoint) {
    if (!transformer.endPoint) continue;
    const ep = transformer.endPoint as string;
    if (!endpointTransformerMap.has(ep)) endpointTransformerMap.set(ep, new Map());
    endpointTransformerMap.get(ep)!.set(name, transformer);
  }

  for (const [endPoint, transformersByName] of endpointTransformerMap) {
    const defaultTransformer = transformersByName.values().next().value;
    fastify.post(
      endPoint,
      async (req: FastifyRequest, reply: FastifyReply) => {
        // Select transformer that matches provider's sole transformer, enabling bypass+auth
        let transformer = defaultTransformer;
        const providerName = (req as any).provider;
        if (providerName) {
          const provider = fastify.providerService.getProvider(providerName);
          if (provider?.transformer?.use?.length === 1) {
            const useName = provider.transformer.use[0]?.name;
            if (useName && transformersByName.has(useName)) {
              transformer = transformersByName.get(useName);
            }
          }
        }
        return handleTransformerEndpoint(req, reply, fastify, transformer);
      }
    );
  }

  fastify.post(
    "/providers",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            type: { type: "string", enum: ["openai", "anthropic"] },
            baseUrl: { type: "string" },
            apiKey: { type: "string" },
            models: { type: "array", items: { type: "string" } },
          },
          required: ["id", "name", "type", "baseUrl", "apiKey", "models"],
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: RegisterProviderRequest }>,
      reply: FastifyReply
    ) => {
      // Validation
      const { name, baseUrl, apiKey, models } = request.body;

      if (!name?.trim()) {
        throw createApiError(
          "Provider name is required",
          400,
          "invalid_request"
        );
      }

      if (!baseUrl || !isValidUrl(baseUrl)) {
        throw createApiError(
          "Valid base URL is required",
          400,
          "invalid_request"
        );
      }

      if (!apiKey?.trim()) {
        throw createApiError("API key is required", 400, "invalid_request");
      }

      if (!models || !Array.isArray(models) || models.length === 0) {
        throw createApiError(
          "At least one model is required",
          400,
          "invalid_request"
        );
      }

      // Check if provider already exists
      if (fastify.providerService.getProvider(request.body.name)) {
        throw createApiError(
          `Provider with name '${request.body.name}' already exists`,
          400,
          "provider_exists"
        );
      }

      return fastify.providerService.registerProvider(request.body);
    }
  );

  fastify.get("/providers", async () => {
    return fastify.providerService.getProviders();
  });

  fastify.get(
    "/providers/:id",
    {
      schema: {
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const provider = fastify.providerService.getProvider(
        request.params.id
      );
      if (!provider) {
        throw createApiError("Provider not found", 404, "provider_not_found");
      }
      return provider;
    }
  );

  fastify.put(
    "/providers/:id",
    {
      schema: {
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: ["openai", "anthropic"] },
            baseUrl: { type: "string" },
            apiKey: { type: "string" },
            models: { type: "array", items: { type: "string" } },
            enabled: { type: "boolean" },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: Partial<LLMProvider>;
      }>,
      reply
    ) => {
      const provider = fastify.providerService.updateProvider(
        request.params.id,
        request.body
      );
      if (!provider) {
        throw createApiError("Provider not found", 404, "provider_not_found");
      }
      return provider;
    }
  );

  fastify.delete(
    "/providers/:id",
    {
      schema: {
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const success = fastify.providerService.deleteProvider(
        request.params.id
      );
      if (!success) {
        throw createApiError("Provider not found", 404, "provider_not_found");
      }
      return { message: "Provider deleted successfully" };
    }
  );

  fastify.patch(
    "/providers/:id/toggle",
    {
      schema: {
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: { enabled: { type: "boolean" } },
          required: ["enabled"],
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { enabled: boolean };
      }>,
      reply
    ) => {
      const success = fastify.providerService.toggleProvider(
        request.params.id,
        request.body.enabled
      );
      if (!success) {
        throw createApiError("Provider not found", 404, "provider_not_found");
      }
      return {
        message: `Provider ${
          request.body.enabled ? "enabled" : "disabled"
        } successfully`,
      };
    }
  );
};

// Helper function
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
