/**
 * Dynamic configuration Schema handler
 * Responsible for parsing and validating configuration schema, handling conditional logic and variable replacement
 *
 * Implementation lives in ./schema/*; this file re-exports the stable
 * public surface consumed via `@/shared`.
 */

export { evaluateCondition, evaluateConditions } from './schema/conditions'
export { buildDependencyGraph } from './schema/dependency-graph'
export { getDynamicOptions } from './schema/dynamic-options'
export { applyConfigMappings } from './schema/mappings'
export { parseFieldPath, setValueByPath } from './schema/paths'
export { replaceTemplateVariables } from './schema/template'
export { applyUserInputs } from './schema/user-inputs'
