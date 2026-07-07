/**
 * StatusLine / transformers path resolution helpers (relative ->
 * absolute against the preset directory).
 */

import path from 'node:path'

/**
 * Process StatusLine configuration, convert relative scriptPath to absolute path
 * @param statusLineConfig StatusLine configuration
 * @param presetDir Preset directory path
 */
function processStatusLineConfig(statusLineConfig: any, presetDir?: string): any {
  if (!statusLineConfig || typeof statusLineConfig !== 'object') {
    return statusLineConfig
  }

  const result = { ...statusLineConfig }

  // Process each theme's modules
  for (const themeKey of Object.keys(result)) {
    const theme = result[themeKey]
    if (theme && typeof theme === 'object' && theme.modules) {
      const modules = Array.isArray(theme.modules) ? theme.modules : []
      const processedModules = modules.map((module: any) => {
        // If module has scriptPath and presetDir is provided, convert to absolute path
        if (module.scriptPath && presetDir && !module.scriptPath.startsWith('/')) {
          return {
            ...module,
            scriptPath: path.join(presetDir, module.scriptPath)
          }
        }
        return module
      })
      result[themeKey] = {
        ...theme,
        modules: processedModules
      }
    }
  }

  return result
}

/**
 * Process transformers configuration, convert relative path to absolute path
 * @param transformersConfig Transformers configuration array
 * @param presetDir Preset directory path
 */
function processTransformersConfig(transformersConfig: any[], presetDir?: string): any[] {
  if (!transformersConfig || !Array.isArray(transformersConfig)) {
    return transformersConfig
  }

  if (!presetDir) {
    return transformersConfig
  }

  return transformersConfig.map((transformer: any) => {
    // If transformer has path and it's a relative path, convert to absolute path
    if (transformer.path && !transformer.path.startsWith('/')) {
      return {
        ...transformer,
        path: path.join(presetDir, transformer.path)
      }
    }
    return transformer
  })
}
