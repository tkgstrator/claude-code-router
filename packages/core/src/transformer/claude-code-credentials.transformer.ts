import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync } from "fs";

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");

// Anthropic OAuth token refresh endpoint
const REFRESH_URL = "https://claude.ai/oauth/token";

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

export class ClaudeCodeCredentialsTransformer {
  name = "claude-code-credentials";
  endPoint = "/v1/messages";

  async auth(request: any, _provider: any) {
    const token = await getValidToken();
    return {
      body: request,
      config: {
        headers: {
          "x-api-key": token,
          "anthropic-version": "2023-06-01",
          Authorization: undefined,
          authorization: undefined,
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
