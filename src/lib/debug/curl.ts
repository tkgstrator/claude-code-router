// Builds the cURL command copied by the "Copy cURL" button.
export function buildCurlCommand(
  method: string,
  url: string,
  headers: Record<string, unknown>,
  body: Record<string, unknown>
): string {
  const headerFlags = Object.entries(headers)
    .map(([key, value]) => ` \\\n  -H "${key}: ${value}"`)
    .join('')
  const bodyFlag = method !== 'GET' && Object.keys(body).length > 0 ? ` \\\n  -d '${JSON.stringify(body)}'` : ''
  return `curl -X ${method} "${url}"${headerFlags}${bodyFlag}`
}
