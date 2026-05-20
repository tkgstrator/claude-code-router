import type { StatusLineConfig } from '@/types'

// Stub kept for callers that still import this surface. Validation
// was removed; the result type is preserved but the array is always
// empty.
export interface ValidationResult {
  isValid: boolean
  errors: string[]
}

export function validateStatusLineConfig(_config: unknown): ValidationResult {
  return { isValid: true, errors: [] }
}

export function formatValidationError(
  _error: unknown,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  return t('statusline.validation.unknown_error')
}

// 颜色枚举到十六进制的映射
export const COLOR_HEX_MAP: Record<string, string> = {
  black: '#000000',
  red: '#cd0000',
  green: '#00cd00',
  yellow: '#cdcd00',
  blue: '#0000ee',
  magenta: '#cd00cd',
  cyan: '#00cdcd',
  white: '#e5e5e5',
  bright_black: '#7f7f7f',
  bright_red: '#ff0000',
  bright_green: '#00ff00',
  bright_yellow: '#ffff00',
  bright_blue: '#5c5cff',
  bright_magenta: '#ff00ff',
  bright_cyan: '#00ffff',
  bright_white: '#ffffff',
  bg_black: '#000000',
  bg_red: '#cd0000',
  bg_green: '#00cd00',
  bg_yellow: '#cdcd00',
  bg_blue: '#0000ee',
  bg_magenta: '#cd00cd',
  bg_cyan: '#00cdcd',
  bg_white: '#e5e5e5',
  bg_bright_black: '#7f7f7f',
  bg_bright_red: '#ff0000',
  bg_bright_green: '#00ff00',
  bg_bright_yellow: '#ffff00',
  bg_bright_blue: '#5c5cff',
  bg_bright_magenta: '#ff00ff',
  bg_bright_cyan: '#00ffff',
  bg_bright_white: '#ffffff'
}

/**
 * 创建默认的StatusLine配置
 */
export function createDefaultStatusLineConfig(): StatusLineConfig {
  return {
    enabled: true,
    currentStyle: 'default',
    default: {
      modules: [
        { type: 'workDir', icon: '󰉋', text: '{{workDirName}}', color: 'bright_blue' },
        { type: 'gitBranch', icon: '', text: '{{gitBranch}}', color: 'bright_magenta' },
        { type: 'model', icon: '󰚩', text: '{{model}}', color: 'bright_cyan' },
        { type: 'usage', icon: '↑', text: '{{inputTokens}}', color: 'bright_green' },
        { type: 'usage', icon: '↓', text: '{{outputTokens}}', color: 'bright_yellow' },
        { type: 'speed', icon: '', text: '{{tokenSpeed}} t/s', color: 'bright_red' }
      ]
    },
    powerline: {
      modules: [
        { type: 'workDir', icon: '󰉋', text: '{{workDirName}}', color: 'white', background: 'bg_bright_blue' },
        { type: 'gitBranch', icon: '', text: '{{gitBranch}}', color: 'white', background: 'bg_bright_magenta' },
        { type: 'model', icon: '󰚩', text: '{{model}}', color: 'white', background: 'bg_bright_cyan' },
        { type: 'usage', icon: '↑', text: '{{inputTokens}}', color: 'white', background: 'bg_bright_green' },
        { type: 'usage', icon: '↓', text: '{{outputTokens}}', color: 'white', background: 'bg_bright_yellow' },
        { type: 'speed', icon: '', text: '{{tokenSpeed}} t/s', color: 'white', background: 'bg_bright_red' }
      ]
    }
  }
}
