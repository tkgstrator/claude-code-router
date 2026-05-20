import { SUBSCRIPTION_PRESETS, type SubscriptionPreset } from '@/shared/data'

// Re-export so existing UI imports of '@/lib/subscriptionPresets' keep
// working. The actual data lives in @/shared/data so the server can
// seed the same set of subscription Providers at boot.
export { SUBSCRIPTION_PRESETS, type SubscriptionPreset }

export const findSubscriptionPreset = (provider: { api_base_url: string }): SubscriptionPreset | undefined =>
  SUBSCRIPTION_PRESETS.find((p) => p.apiBaseUrl === provider.api_base_url)
