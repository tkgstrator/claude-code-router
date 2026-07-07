import type { StatusLineModuleConfig } from '@/types'

export const DEFAULT_MODULE: StatusLineModuleConfig = {
  type: 'workDir',
  icon: '󰉋',
  text: '{{workDirName}}',
  color: 'bright_blue'
}

// Nerd Font options
export const NERD_FONTS = [
  { label: 'Hack Nerd Font Mono', value: 'Hack Nerd Font Mono' },
  { label: 'FiraCode Nerd Font Mono', value: 'FiraCode Nerd Font Mono' },
  {
    label: 'JetBrainsMono Nerd Font Mono',
    value: 'JetBrainsMono Nerd Font Mono'
  },
  { label: 'Monaspace Nerd Font Mono', value: 'Monaspace Nerd Font Mono' },
  { label: 'UbuntuMono Nerd Font', value: 'UbuntuMono Nerd Font' }
]

// Module type options
export const MODULE_TYPES = [
  { label: 'workDir', value: 'workDir' },
  { label: 'gitBranch', value: 'gitBranch' },
  { label: 'model', value: 'model' },
  { label: 'usage', value: 'usage' },
  { label: 'speed', value: 'speed' },
  { label: 'script', value: 'script' }
]

// ANSI color code mapping
export const ANSI_COLORS: Record<string, string> = {
  // Standard colors
  black: 'text-black',
  red: 'text-red-600',
  green: 'text-green-600',
  yellow: 'text-yellow-500',
  blue: 'text-blue-500',
  magenta: 'text-purple-500',
  cyan: 'text-cyan-500',
  white: 'text-white',
  // Bright colors
  bright_black: 'text-gray-500',
  bright_red: 'text-red-400',
  bright_green: 'text-green-400',
  bright_yellow: 'text-yellow-300',
  bright_blue: 'text-blue-300',
  bright_magenta: 'text-purple-300',
  bright_cyan: 'text-cyan-300',
  bright_white: 'text-white',
  // Background colors
  bg_black: 'bg-black',
  bg_red: 'bg-red-600',
  bg_green: 'bg-green-600',
  bg_yellow: 'bg-yellow-500',
  bg_blue: 'bg-blue-500',
  bg_magenta: 'bg-purple-500',
  bg_cyan: 'bg-cyan-500',
  bg_white: 'bg-white',
  // Bright background colors
  bg_bright_black: 'bg-gray-800',
  bg_bright_red: 'bg-red-400',
  bg_bright_green: 'bg-green-400',
  bg_bright_yellow: 'bg-yellow-300',
  bg_bright_blue: 'bg-blue-300',
  bg_bright_magenta: 'bg-purple-300',
  bg_bright_cyan: 'bg-cyan-300',
  bg_bright_white: 'bg-gray-100',
  // Extra background colors required by the Powerline style
  bg_bright_orange: 'bg-orange-400',
  bg_bright_purple: 'bg-purple-400'
}
