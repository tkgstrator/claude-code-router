/**
 * Normalises an inbound image payload into a `data:` URL.
 *
 * Accepts either a raw base64 blob or a value that already includes the
 * `base64` marker (or full data-URL); always returns
 * `data:<media_type>;base64,<payload>`.
 */
export const formatBase64 = (data: string, media_type: string): string => {
  let payload = data
  if (payload.includes('base64')) {
    const tail = payload.split('base64').pop()
    payload = tail ? tail : ''
    if (payload.startsWith(',')) {
      payload = payload.slice(1)
    }
  }
  return `data:${media_type};base64,${payload}`
}
