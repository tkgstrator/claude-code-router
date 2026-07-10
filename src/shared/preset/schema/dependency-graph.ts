/**
 * Build the field dependency graph used to order schema field updates.
 */

import type { RequiredInput } from '../types'

/**
 * Build field dependency graph (for optimizing update order)
 */
export function buildDependencyGraph(fields: RequiredInput[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>()

  for (const field of fields) {
    const deps = new Set<string>()

    // Extract from dependsOn
    if (field.dependsOn) {
      for (const dep of field.dependsOn) {
        deps.add(dep)
      }
    }

    // Extract dependencies from when conditions
    if (field.when) {
      const conditions = Array.isArray(field.when) ? field.when : [field.when]
      for (const cond of conditions) {
        deps.add(cond.field)
      }
    }

    // Extract dependencies from dynamic options
    if (field.options) {
      const options = field.options as any
      if (options.type === 'models' && options.providerField) {
        const providerId = String(options.providerField).replace(/^#{(.+)}$/, '$1')
        deps.add(providerId)
      }
    }

    graph.set(field.id, deps)
  }

  return graph
}
