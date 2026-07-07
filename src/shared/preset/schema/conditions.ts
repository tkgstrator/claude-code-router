/**
 * Conditional-expression evaluation for schema fields (`when` clauses).
 */

import type { Condition, UserInputValues } from '../types'

/**
 * Evaluate conditional expression
 */
export function evaluateCondition(condition: Condition, values: UserInputValues): boolean {
  const actualValue = values[condition.field]

  // Handle exists operator
  if (condition.operator === 'exists') {
    return actualValue !== undefined && actualValue !== null
  }

  // Handle in operator
  if (condition.operator === 'in') {
    return Array.isArray(condition.value) && condition.value.includes(actualValue)
  }

  // Handle nin operator
  if (condition.operator === 'nin') {
    return Array.isArray(condition.value) && !condition.value.includes(actualValue)
  }

  // Handle other operators
  switch (condition.operator) {
    case 'eq':
      return actualValue === condition.value
    case 'ne':
      return actualValue !== condition.value
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte': {
      // Relational operators only make sense for numeric values.
      if (typeof actualValue !== 'number' || typeof condition.value !== 'number') {
        return false
      }
      if (condition.operator === 'gt') return actualValue > condition.value
      if (condition.operator === 'lt') return actualValue < condition.value
      if (condition.operator === 'gte') return actualValue >= condition.value
      return actualValue <= condition.value
    }
    default:
      // Default to eq
      return actualValue === condition.value
  }
}

/**
 * Evaluate multiple conditions (AND logic)
 */
export function evaluateConditions(conditions: Condition | Condition[], values: UserInputValues): boolean {
  if (!conditions) {
    return true
  }

  if (!Array.isArray(conditions)) {
    return evaluateCondition(conditions, values)
  }

  // If array, use AND logic (all conditions must be satisfied)
  return conditions.every((condition) => evaluateCondition(condition, values))
}
