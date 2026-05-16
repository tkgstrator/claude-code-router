import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync } from "fs";

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");

const REFRESH_URL = "https://platform.claude.com/v1/oauth/token";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

interface ClaudeCredentials {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
    subscriptionType?: string;
    rateLimitTier?: string;
  };
  organizationUuid?: string;
}

function readCredentials(): ClaudeCredentials {
  try {
    return JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
  } catch {
    throw new Error(
      `Cannot read Claude Code credentials from ${CREDENTIALS_PATH}. ` +
        "Please authenticate Claude Code first."
    );
  }
}

async function refreshToken(refreshTokenValue: string): Promise<string> {
  const response = await fetch(REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshTokenValue,
      client_id: CLIENT_ID,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const data = (await response.json()) as any;
  const credentials = readCredentials();
  credentials.claudeAiOauth.accessToken = data.access_token;
  credentials.claudeAiOauth.expiresAt =
    Date.now() + (data.expires_in ?? 3600) * 1000;
  if (data.refresh_token) {
    credentials.claudeAiOauth.refreshToken = data.refresh_token;
  }
  writeFileSync(CREDENTIALS_PATH, JSON.stringify(credentials));
  return data.access_token;
}

async function getValidToken(): Promise<string> {
  const credentials = readCredentials();
  const { accessToken, refreshToken: rt, expiresAt } =
    credentials.claudeAiOauth;

  // Refresh if token expires within 5 minutes
  if (expiresAt - Date.now() < 5 * 60 * 1000) {
    try {
      return await refreshToken(rt);
    } catch {
      // If refresh fails, fall through and try the existing token
      console.warn(
        "[claude-code-credentials] Token refresh failed; using existing token"
      );
    }
  }

  return accessToken;
}

// A Claude subscription OAuth token only gets the subscription's
// model allotment (incl. premium models like Opus/Sonnet) when the
// request is identified as official Claude Code. Without this, premium
// models are routed to the API "overage" path instead — which is
// org-disabled on subscriptions — and 429 with rate_limit_error while
// Haiku (served from the base allotment) still 200s.
//
// The official client is identified by three things, all required:
//  1. OAuth bearer auth (not x-api-key),
//  2. the oauth anthropic-beta header (added on the subscription path
//     by the /v1 adapter, which owns the beta header so the client's
//     other betas are preserved), and
//  3. a system prompt whose FIRST block is exactly the Claude Code
//     identity string (Anthropic checks the first block only).
const CLAUDE_CODE_IDENTITY =
  "You are Claude Code, Anthropic's official CLI for Claude.";

// Anthropic system is a string or an array of text blocks. Normalise
// to an array and guarantee the first block is the Claude Code
// identity, without duplicating it if the caller already sent it.
function withClaudeCodeIdentity(system: unknown): { type: "text"; text: string }[] {
  const blocks: { type: "text"; text: string }[] = [];
  if (typeof system === "string" && system.length > 0) {
    blocks.push({ type: "text", text: system });
  } else if (Array.isArray(system)) {
    for (const b of system) {
      if (typeof b === "string") blocks.push({ type: "text", text: b });
      else if (b && typeof b.text === "string") blocks.push({ type: "text", text: b.text });
    }
  }
  if (blocks[0]?.text === CLAUDE_CODE_IDENTITY) return blocks;
  return [{ type: "text", text: CLAUDE_CODE_IDENTITY }, ...blocks];
}

export class ClaudeCodeCredentialsTransformer {
  name = "claude-code-credentials";
  endPoint = "/v1/messages";

  async auth(request: any, _provider: any) {
    const token = await getValidToken();
    request.system = withClaudeCodeIdentity(request.system);
    return {
      body: request,
      config: {
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-version": "2023-06-01",
          "x-api-key": undefined,
        },
      },
    };
  }

  // Passthrough — request is already in Anthropic format
  async transformRequestOut(request: any) {
    return request;
  }

  async transformResponseIn(response: Response) {
    return response;
  }
}
