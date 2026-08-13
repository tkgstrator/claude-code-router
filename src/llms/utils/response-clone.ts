/**
 * Clone a fetch `Response` while swapping the body (and optionally
 * overriding some headers).
 *
 * Preserves `status`, `statusText`, and header fields from `source`
 * verbatim — matches the ~12 hand-written `new Response(body, {
 * status: response.status, statusText: response.statusText,
 * headers: response.headers })` sites that were previously scattered
 * across the transformer chain.
 */

export function cloneResponse(
  source: Response,
  body: BodyInit | null,
  headerOverrides?: Record<string, string>
): Response {
  const headers = headerOverrides
    ? new Headers({ ...Object.fromEntries(source.headers), ...headerOverrides })
    : source.headers
  return new Response(body, {
    status: source.status,
    statusText: source.statusText,
    headers
  })
}
