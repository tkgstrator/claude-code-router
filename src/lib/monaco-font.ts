/**
 * Monaco Editor `fontFamily` — kept in sync with `--font-mono` in
 * `src/index.css`. Monaco does not resolve CSS custom properties, so the
 * string is duplicated here as the single source of truth for editor
 * instances. Update both places together when the mono family changes.
 */
export const MONACO_FONT_FAMILY =
  "'Geist Mono Variable', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
