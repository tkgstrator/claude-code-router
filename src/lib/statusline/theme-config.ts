import type { StatusLineThemeConfig } from '@/types'

// Not every StatusLineConfig value has a `modules` array — `enabled`,
// `currentStyle` and `fontFamily` are scalars. Only the theme slots
// (`default`, `powerline`) satisfy this shape.
export function isThemeConfig(value: unknown): value is StatusLineThemeConfig {
  return typeof value === 'object' && value !== null && 'modules' in value
}
