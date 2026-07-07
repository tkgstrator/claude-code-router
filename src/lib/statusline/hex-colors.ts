import type { StatusLineConfig, StatusLineModuleConfig } from '@/types'
import { isThemeConfig } from './theme-config'

const HEX_COLOR_RE = /^#[0-9A-F]{6}$/i

function isHexColor(color: string | undefined): color is string {
  return typeof color === 'string' && HEX_COLOR_RE.test(color)
}

// Union of every hex background color referenced by any theme's modules, so
// the caller can inject matching separator CSS for the Powerline preview.
export function collectHexBackgroundColors(config: StatusLineConfig): Set<string> {
  const modules: StatusLineModuleConfig[] = Object.values(config).flatMap((value) =>
    isThemeConfig(value) ? value.modules : []
  )
  return new Set(modules.map((module) => module.background).filter(isHexColor))
}

// One CSS rule per hex color, mapping the powerline separator's border color
// to the matching module background.
export function buildHexColorCss(colors: Set<string>): string {
  return Array.from(colors)
    .map((color) => {
      const r = parseInt(color.slice(1, 3), 16)
      const g = parseInt(color.slice(3, 5), 16)
      const b = parseInt(color.slice(5, 7), 16)
      return `.powerline-separator[data-current-bg="${color}"] { border-left-color: rgb(${r}, ${g}, ${b}); }`
    })
    .join('\n')
}
