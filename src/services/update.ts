// The published package this deployment tracks for update checks.
const NPM_PACKAGE = '@musistudio/claude-code-router'
// npm registry dist-tag endpoint: returns the manifest of the
// `latest` release (including its `version`). Queried over plain HTTP
// so no `npm` binary or child process is involved — the production
// image runs on Bun (oven/bun) and ships no npm.
const NPM_REGISTRY_LATEST_URL = `https://registry.npmjs.org/${NPM_PACKAGE}/latest`

export async function checkForUpdates(currentVersion: string) {
  try {
    const response = await fetch(NPM_REGISTRY_LATEST_URL, {
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) {
      throw new Error(`npm registry returned HTTP ${response.status}`)
    }
    // fetch().json() is `any`; narrow the single field we need with a
    // runtime type guard instead of an unchecked `as` assertion.
    const body = await response.json()
    const latestVersion: unknown = body?.version
    if (typeof latestVersion !== 'string' || latestVersion.length === 0) {
      throw new Error('npm registry response had no version field')
    }
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0
    return { hasUpdate, latestVersion, changelog: '' }
  } catch (error) {
    console.error('Error checking for updates:', error)
    return { hasUpdate: false, latestVersion: currentVersion, changelog: '' }
  }
}

export async function performUpdate() {
  // The production deployment runs as an immutable container image
  // (oven/bun, no npm). An in-place `npm update -g` cannot work and
  // would only corrupt the running install, so this is intentionally
  // a no-op that tells the operator how to actually upgrade.
  return {
    success: false,
    message:
      'Self-update is not available in this deployment. Pull the latest image and redeploy (e.g. `docker compose pull && docker compose up -d`).'
  }
}

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const num1 = i < parts1.length ? parts1[i] : 0
    const num2 = i < parts2.length ? parts2[i] : 0
    if (num1 > num2) return 1
    if (num1 < num2) return -1
  }
  return 0
}
