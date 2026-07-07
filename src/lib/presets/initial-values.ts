import type { RequiredInput } from './types'

// Seed a DynamicConfigForm's initial state: prefer a previously-saved
// userValue for the field, otherwise fall back to the schema's own
// defaultValue. Shared by every install/view-detail flow that opens the
// preset configuration dialog.
export function buildInitialValues(
  schema: RequiredInput[],
  // biome-ignore lint/suspicious/noExplicitAny: userValues are arbitrary JSON keyed by schema field id
  userValues: Record<string, any> | undefined
  // biome-ignore lint/suspicious/noExplicitAny: form values are arbitrary JSON keyed by schema field id
): Record<string, any> {
  // biome-ignore lint/suspicious/noExplicitAny: form values are arbitrary JSON keyed by schema field id
  const initialValues: Record<string, any> = {}
  for (const input of schema) {
    if (userValues && userValues[input.id] !== undefined) {
      initialValues[input.id] = userValues[input.id]
    } else {
      initialValues[input.id] = input.defaultValue ?? ''
    }
  }
  return initialValues
}
