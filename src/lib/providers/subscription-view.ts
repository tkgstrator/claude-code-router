// Shapes and formatters for the subscription accounts panel in the provider
// edit dialog. Kept dependency-free so they can be shared between
// Providers.tsx and its sub-components without pulling in React.
export type SubscriptionAccountView = {
  id: string
  label: string
  sourcePath: string
  enabled: boolean
  userName: string | null
  userEmail: string | null
  userId: string | null
  plan: string | null
}

export type SubscriptionView = {
  providerName: string
  enabled: boolean
  accounts: SubscriptionAccountView[]
  activeAccount: SubscriptionAccountView | null
}

export const accountSummary = (a: SubscriptionAccountView): string =>
  [a.userName, a.userEmail, a.userId].filter(Boolean).join(' / ') || a.label

export const formatPlan = (plan: string): string => plan.replace(/^(claude|codex)_/i, '')
