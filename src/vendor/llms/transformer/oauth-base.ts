// Shared scaffolding for subscription-OAuth transformers (claude-code,
// codex, …). Vendor-specific bits — default credential file path,
// on-disk file shape and any refresh logic — live in the concrete
// subclass; the base only handles the two patterns every vendor shares:
//
//   1. credential file path resolution: honour
//      `provider.transformer.subscriptionCredentialPath` when present,
//      otherwise fall back to the vendor's default location.
//   2. token source preference: when the DB has already synced an
//      access token (`provider.transformer.subscriptionAuth.accessToken`),
//      use it; otherwise read from disk via `readFromDisk`.
//
// Adding a new OAuth-authed vendor only requires implementing two
// abstract members and the vendor's transformer hook (auth /
// transformRequestIn / …).

export interface OauthCredentials {
  token: string
  // Codex needs the ChatGPT account id for the chatgpt-account-id
  // request header. Vendors without that concept leave it undefined.
  accountId?: string
}

export abstract class OauthTransformerBase {
  abstract name: string

  // Vendor default location of the credential file (e.g. claude
  // writes ~/.claude/.credentials.json, codex writes ~/.codex/auth.json).
  protected abstract defaultCredentialPath: string

  // Vendor-specific reader: parse the on-disk file and return a usable
  // access token (+ optional accountId). Claude's implementation also
  // refreshes near-expiry tokens; codex's is a plain read.
  protected abstract readFromDisk(path: string): Promise<OauthCredentials>

  // The llms `provider` is intentionally loosely typed across the
  // vendored package (`any`), so the helpers below follow that
  // convention. Each field access is still typeof-guarded before use.
  protected resolveCredentialsPath(provider: any): string {
    const override = provider?.transformer?.subscriptionCredentialPath
    if (typeof override === 'string' && override.length > 0) return override
    return this.defaultCredentialPath
  }

  // Resolve the credentials to use for THIS request. The DB-synced
  // token (when present) always wins — it's kept current by the
  // subscription-account-sync service — and avoids the file read on
  // the hot path. Disk fallback handles the boot-time / unmigrated
  // case where the DB has no token yet.
  protected async resolveSubscriptionAuth(provider: any): Promise<OauthCredentials> {
    const auth = provider?.transformer?.subscriptionAuth
    const dbToken = typeof auth?.accessToken === 'string' ? auth.accessToken : ''
    if (dbToken.length > 0) {
      const dbAccountId = typeof auth?.accountId === 'string' ? auth.accountId : undefined
      return { token: dbToken, accountId: dbAccountId }
    }
    return this.readFromDisk(this.resolveCredentialsPath(provider))
  }
}
