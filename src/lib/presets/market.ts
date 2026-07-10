import type { MarketPreset, PresetMetadata } from './types'

// Case-insensitive substring match across name/description/author, mirroring
// the search box in the market dialog.
export function filterMarketPresets(presets: MarketPreset[], query: string): MarketPreset[] {
  const q = query.toLowerCase()
  return presets.filter(
    (preset) =>
      preset.name.toLowerCase().includes(q) ||
      preset.description?.toLowerCase().includes(q) ||
      preset.author?.toLowerCase().includes(q)
  )
}

// A market preset is considered installed when one of the already-installed
// presets matches it by GitHub repo (preferred) or, failing that, by name.
export function isMarketPresetInstalled(preset: MarketPreset, installed: PresetMetadata[]): boolean {
  return installed.some((p) => {
    if (p.repository) {
      const installedRepo = p.repository.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')
      if (installedRepo === preset.repo) return true
    }
    return p.name === preset.name
  })
}
