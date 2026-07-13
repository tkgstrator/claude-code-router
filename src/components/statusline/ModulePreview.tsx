import type React from 'react'
import { ANSI_COLORS } from '@/lib/statusline/constants'
import { PREVIEW_VARIABLES, replaceVariables } from '@/lib/statusline/preview'
import type { StatusLineModuleConfig } from '@/types'

// Detect a hex color value
const isHexColor = (color: string) => /^#[0-9A-F]{6}$/i.test(color)

// Render a preview for a single module
export function renderModulePreview(module: StatusLineModuleConfig, isPowerline: boolean = false): React.ReactNode {
  const text = replaceVariables(module.text, PREVIEW_VARIABLES)
  const icon = module.icon || ''

  // Skip the module when text is empty and the type is not usage
  if (!text && module.type !== 'usage') {
    return null
  }

  // For the Powerline style, apply background colors and separators
  if (isPowerline) {
    // Resolve the background color - supports ANSI names and hex values
    let bgColorStyle = {}
    let bgColorClass = ''
    let separatorDataBg = ''
    if (module.background) {
      if (isHexColor(module.background)) {
        bgColorStyle = { backgroundColor: module.background }
        // For hex colors, use the value directly as the data attribute
        separatorDataBg = module.background
      } else {
        bgColorClass = ANSI_COLORS[module.background] || ''
        separatorDataBg = module.background
      }
    }

    // Resolve the text color - supports ANSI names and hex values
    let textColorStyle = {}
    let textColorClass = ''
    if (module.color) {
      if (isHexColor(module.color)) {
        textColorStyle = { color: module.color }
      } else {
        textColorClass = ANSI_COLORS[module.color] || 'text-white'
      }
    } else {
      textColorClass = 'text-white'
    }

    return (
      <div
        className={`powerline-module px-4 ${bgColorClass} ${textColorClass}`}
        style={{ ...bgColorStyle, ...textColorStyle }}
      >
        <div className='powerline-module-content'>
          {icon && <span>{icon}</span>}
          <span>{text}</span>
        </div>
        <div className='powerline-separator' data-current-bg={separatorDataBg} />
      </div>
    )
  }

  // Resolve colors for the default style
  let textStyle = {}
  let textClass = ''
  if (module.color) {
    if (isHexColor(module.color)) {
      textStyle = { color: module.color }
    } else {
      textClass = ANSI_COLORS[module.color] || ''
    }
  }

  return (
    <>
      {icon && (
        <span style={textStyle} className={textClass}>
          {icon}
        </span>
      )}
      <span style={textStyle} className={textClass}>
        {text}
      </span>
    </>
  )
}
