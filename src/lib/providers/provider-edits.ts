import { isDeprecatedModel } from '@/shared/data'
import type { Provider } from '@/types'

// Pure state-transition helpers behind the provider edit dialog's form
// handlers. Each function takes the in-progress `Provider` draft and
// returns the next draft (or `null` when nothing should change); the
// dialog's handlers stay thin wrappers around setEditingProviderData.

export function applyProviderFieldChange(provider: Provider, field: string, value: string): Provider {
  const updatedProvider = { ...provider, [field]: value }
  // When the API key transitions empty -> non-empty, the model switches
  // flip from "all off (key missing gate)" to "all on minus
  // _disabledModels". Without seeding, deprecated models would all turn
  // on. Materialize the deprecated set into _disabledModels on that
  // edge so they start OFF; from then on it's a normal disabled list
  // the user controls (enabling one removes it and persists).
  if (field === 'api_key') {
    const had = (provider.api_key?.trim().length ?? 0) > 0
    const has = value.trim().length > 0
    if (!had && has) {
      const models: string[] = Array.isArray(updatedProvider.models) ? updatedProvider.models : []
      const serverDeprecated = Array.isArray(updatedProvider.deprecatedModels) ? updatedProvider.deprecatedModels : []
      const deprecated = models.filter((m) => serverDeprecated.includes(m) || isDeprecatedModel(m))
      if (deprecated.length > 0) {
        const transformer = { ...(updatedProvider.transformer ?? { use: [] }) }
        const existing = Array.isArray(transformer._disabledModels) ? (transformer._disabledModels as string[]) : []
        transformer._disabledModels = [...new Set([...existing, ...deprecated])]
        updatedProvider.transformer = transformer
      }
    }
  }
  return updatedProvider
}

export function addProviderTransformerUse(provider: Provider, transformerPath: string): Provider {
  const updatedProvider = { ...provider }
  if (!updatedProvider.transformer) {
    updatedProvider.transformer = { use: [] }
  }
  if (!updatedProvider.transformer.use) {
    updatedProvider.transformer.use = []
  }
  updatedProvider.transformer.use = [...updatedProvider.transformer.use, transformerPath]
  return updatedProvider
}

export function removeProviderTransformerUseAt(provider: Provider, transformerIndex: number): Provider {
  const updatedProvider = { ...provider }
  if (updatedProvider.transformer) {
    if (!updatedProvider.transformer.use) {
      updatedProvider.transformer.use = []
    }
    const newUseArray = [...updatedProvider.transformer.use]
    newUseArray.splice(transformerIndex, 1)
    updatedProvider.transformer.use = newUseArray
    // If use array is now empty and no other properties, remove transformer entirely
    if (newUseArray.length === 0 && Object.keys(updatedProvider.transformer).length === 1) {
      delete updatedProvider.transformer
    }
  }
  return updatedProvider
}

export function addModelTransformerUse(provider: Provider, model: string, transformerPath: string): Provider {
  const updatedProvider = { ...provider }
  if (!updatedProvider.transformer) {
    updatedProvider.transformer = { use: [] }
  }
  if (!updatedProvider.transformer[model]) {
    updatedProvider.transformer[model] = { use: [] }
  }
  updatedProvider.transformer[model].use = [...updatedProvider.transformer[model].use, transformerPath]
  return updatedProvider
}

export function setModelDisabled(provider: Provider, model: string, disabled: boolean): Provider {
  const updatedProvider = { ...provider }
  const transformer = { ...(updatedProvider.transformer ?? { use: [] }) }
  const current = Array.isArray((transformer as Record<string, unknown>)._disabledModels)
    ? [...(transformer as Record<string, string[]>)._disabledModels]
    : []
  const next = (() => {
    if (disabled) {
      return current.includes(model) ? current : [...current, model]
    }
    return current.filter((m) => m !== model)
  })()
  if (next.length === 0) {
    delete (transformer as Record<string, unknown>)._disabledModels
  } else {
    ;(transformer as Record<string, unknown>)._disabledModels = next
  }
  updatedProvider.transformer = transformer
  return updatedProvider
}

export function setModelEnabled(provider: Provider, model: string, enabled: boolean): Provider {
  const updatedProvider = { ...provider }
  const current = Array.isArray(updatedProvider.models) ? [...updatedProvider.models] : []
  if (enabled) {
    if (!current.includes(model)) current.push(model)
  } else {
    const idx = current.indexOf(model)
    if (idx >= 0) current.splice(idx, 1)
  }
  updatedProvider.models = current
  if (!enabled && updatedProvider.transformer && updatedProvider.transformer[model]) {
    const nextTransformer = { ...updatedProvider.transformer }
    delete nextTransformer[model]
    updatedProvider.transformer = nextTransformer
  }
  return updatedProvider
}

export function setModelTransformerUse(provider: Provider, model: string, names: string[]): Provider {
  const updatedProvider = { ...provider }
  if (!updatedProvider.transformer) {
    updatedProvider.transformer = { use: [] }
  }
  const existing = updatedProvider.transformer[model]?.use ?? []
  const byName = new Map<string, string | (string | Record<string, unknown> | { max_tokens: number })[]>()
  for (const entry of existing) {
    const name = typeof entry === 'string' ? entry : String((entry as Array<unknown>)[0])
    byName.set(name, entry)
  }
  const newUse = names.map((name) => byName.get(name) ?? name)
  if (newUse.length === 0) {
    delete updatedProvider.transformer[model]
  } else {
    updatedProvider.transformer[model] = { ...(updatedProvider.transformer[model] ?? {}), use: newUse }
  }
  return updatedProvider
}

export function removeModelTransformerUseAt(provider: Provider, model: string, transformerIndex: number): Provider {
  const updatedProvider = { ...provider }
  if (updatedProvider.transformer && updatedProvider.transformer[model]) {
    const newUseArray = [...updatedProvider.transformer[model].use]
    newUseArray.splice(transformerIndex, 1)
    updatedProvider.transformer[model].use = newUseArray
    // If use array is now empty and no other properties, remove model transformer entirely
    if (newUseArray.length === 0 && Object.keys(updatedProvider.transformer[model]).length === 1) {
      delete updatedProvider.transformer[model]
    }
  }
  return updatedProvider
}

export function addProviderTransformerParam(
  provider: Provider,
  transformerIndex: number,
  paramName: string,
  paramValue: string
): Provider {
  const updatedProvider = { ...provider }
  if (!updatedProvider.transformer) {
    updatedProvider.transformer = { use: [] }
  }
  // Add parameter to the specified transformer in use array
  if (updatedProvider.transformer.use && updatedProvider.transformer.use.length > transformerIndex) {
    const targetTransformer = updatedProvider.transformer.use[transformerIndex]
    // If it's already an array with parameters, update it
    if (Array.isArray(targetTransformer)) {
      const transformerArray = [...targetTransformer]
      // Check if the second element is an object (parameters object)
      if (transformerArray.length > 1 && typeof transformerArray[1] === 'object' && transformerArray[1] !== null) {
        // Update the existing parameters object
        const existingParams = transformerArray[1] as Record<string, unknown>
        const paramsObj: Record<string, unknown> = { ...existingParams, [paramName]: paramValue }
        transformerArray[1] = paramsObj
      } else if (transformerArray.length > 1) {
        // If there are other elements, add the parameters object
        const paramsObj = { [paramName]: paramValue }
        transformerArray.splice(1, transformerArray.length - 1, paramsObj)
      } else {
        // Add a new parameters object
        const paramsObj = { [paramName]: paramValue }
        transformerArray.push(paramsObj)
      }
      updatedProvider.transformer.use[transformerIndex] = transformerArray as
        | string
        | (string | Record<string, unknown> | { max_tokens: number })[]
    } else {
      // Convert to array format with parameters
      const paramsObj = { [paramName]: paramValue }
      updatedProvider.transformer.use[transformerIndex] = [targetTransformer as string, paramsObj]
    }
  }
  return updatedProvider
}

export function removeProviderTransformerParamAt(
  provider: Provider,
  transformerIndex: number,
  paramName: string
): Provider | null {
  const updatedProvider = { ...provider }
  if (!updatedProvider.transformer?.use || updatedProvider.transformer.use.length <= transformerIndex) {
    return null
  }
  const targetTransformer = updatedProvider.transformer.use[transformerIndex]
  if (!(Array.isArray(targetTransformer) && targetTransformer.length > 1)) {
    return null
  }
  const transformerArray = [...targetTransformer]
  // Check if the second element is an object (parameters object)
  if (typeof transformerArray[1] !== 'object' || transformerArray[1] === null) {
    return null
  }
  const paramsObj = { ...(transformerArray[1] as Record<string, unknown>) }
  delete paramsObj[paramName]
  // If the parameters object is now empty, remove it
  if (Object.keys(paramsObj).length === 0) {
    transformerArray.splice(1, 1)
  } else {
    transformerArray[1] = paramsObj
  }
  updatedProvider.transformer.use[transformerIndex] = transformerArray
  return updatedProvider
}

export function addModelTransformerParam(
  provider: Provider,
  model: string,
  transformerIndex: number,
  paramName: string,
  paramValue: string
): Provider {
  const updatedProvider = { ...provider }
  if (!updatedProvider.transformer) {
    updatedProvider.transformer = { use: [] }
  }
  if (!updatedProvider.transformer[model]) {
    updatedProvider.transformer[model] = { use: [] }
  }
  // Add parameter to the specified transformer in use array
  if (updatedProvider.transformer[model].use && updatedProvider.transformer[model].use.length > transformerIndex) {
    const targetTransformer = updatedProvider.transformer[model].use[transformerIndex]
    // If it's already an array with parameters, update it
    if (Array.isArray(targetTransformer)) {
      const transformerArray = [...targetTransformer]
      // Check if the second element is an object (parameters object)
      if (transformerArray.length > 1 && typeof transformerArray[1] === 'object' && transformerArray[1] !== null) {
        // Update the existing parameters object
        const existingParams = transformerArray[1] as Record<string, unknown>
        const paramsObj: Record<string, unknown> = { ...existingParams, [paramName]: paramValue }
        transformerArray[1] = paramsObj
      } else if (transformerArray.length > 1) {
        // If there are other elements, add the parameters object
        const paramsObj = { [paramName]: paramValue }
        transformerArray.splice(1, transformerArray.length - 1, paramsObj)
      } else {
        // Add a new parameters object
        const paramsObj = { [paramName]: paramValue }
        transformerArray.push(paramsObj)
      }
      updatedProvider.transformer[model].use[transformerIndex] = transformerArray as
        | string
        | (string | Record<string, unknown> | { max_tokens: number })[]
    } else {
      // Convert to array format with parameters
      const paramsObj = { [paramName]: paramValue }
      updatedProvider.transformer[model].use[transformerIndex] = [targetTransformer as string, paramsObj]
    }
  }
  return updatedProvider
}

export function removeModelTransformerParamAt(
  provider: Provider,
  model: string,
  transformerIndex: number,
  paramName: string
): Provider | null {
  const updatedProvider = { ...provider }
  if (!updatedProvider.transformer?.[model]?.use || updatedProvider.transformer[model].use.length <= transformerIndex) {
    return null
  }
  const targetTransformer = updatedProvider.transformer[model].use[transformerIndex]
  if (!(Array.isArray(targetTransformer) && targetTransformer.length > 1)) {
    return null
  }
  const transformerArray = [...targetTransformer]
  if (typeof transformerArray[1] !== 'object' || transformerArray[1] === null) {
    return null
  }
  const paramsObj = { ...(transformerArray[1] as Record<string, unknown>) }
  delete paramsObj[paramName]
  // If the parameters object is now empty, remove it
  if (Object.keys(paramsObj).length === 0) {
    transformerArray.splice(1, 1)
  } else {
    transformerArray[1] = paramsObj
  }
  updatedProvider.transformer[model].use[transformerIndex] = transformerArray
  return updatedProvider
}

export function addProviderModel(provider: Provider, model: string): Provider | null {
  if (!model.trim()) return null
  const updatedProvider = { ...provider }
  const models = Array.isArray(updatedProvider.models) ? [...updatedProvider.models] : []
  if (models.includes(model.trim())) return null
  models.push(model.trim())
  updatedProvider.models = models
  return updatedProvider
}

export function removeProviderModelAt(provider: Provider, modelIndex: number): Provider | null {
  const updatedProvider = { ...provider }
  const models = Array.isArray(updatedProvider.models) ? [...updatedProvider.models] : []
  if (modelIndex < 0 || modelIndex >= models.length) return null
  models.splice(modelIndex, 1)
  updatedProvider.models = models
  return updatedProvider
}
