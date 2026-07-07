/**
 * Template variable replacement (`#{variable}` syntax — distinct from
 * statusline's `{{variable}}` format).
 */

import type { UserInputValues } from '../types'

/**
 * Template variable replacement
 * Supports #{variable} syntax (different from statusline's {{variable}} format)
 */
export function replaceTemplateVariables(template: any, values: UserInputValues): any {
  if (template === null || template === undefined) {
    return template
  }

  // Handle strings
  if (typeof template === 'string') {
    return template.replace(/#{(\w+)}/g, (_, key) => {
      return values[key] !== undefined ? String(values[key]) : ''
    })
  }

  // Handle arrays
  if (Array.isArray(template)) {
    return template.map((item) => replaceTemplateVariables(item, values))
  }

  // Handle objects
  if (typeof template === 'object') {
    const result: any = {}
    for (const [key, value] of Object.entries(template)) {
      result[key] = replaceTemplateVariables(value, values)
    }
    return result
  }

  // Return other types directly
  return template
}
