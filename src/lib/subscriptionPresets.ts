import { SUBSCRIPTION_PRESETS, type SubscriptionPreset } from '@ccr/shared/data'
import type { Provider } from '@/types'

// Re-export so existing UI imports of '@/lib/subscriptionPresets' keep
// working. The actual data lives in @ccr/shared/data so the server can
// seed the same set of subscription Providers at boot.
export { SUBSCRIPTION_PRESETS, type SubscriptionPreset }

export const findSubscriptionPreset = (provider: { api_base_url: string }): SubscriptionPreset | undefined =>
  SUBSCRIPTION_PRESETS.find((p) => p.apiBaseUrl === provider.api_base_url)

export const buildSubscriptionProvider = (preset: SubscriptionPreset, name: string): Provider => ({
  name,
  api_base_url: preset.apiBaseUrl,
  api_key: '',
  auth_mode: 'subscription',
  models: [...preset.defaultEnabledModels]
})
