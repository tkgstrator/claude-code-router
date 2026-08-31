/**
 * The Settings page form.
 *
 * Uses plain `zod`, not `@hono/zod-openapi`, because a form shape is
 * never registered with the OpenAPI document — it exists only between
 * react-hook-form and the api payload it is submitted as.
 *
 * It is a separate shape from api/config.ts rather than a reuse of it
 * because the two disagree on purpose: a blank input is valid here and
 * defaults to '', where the api layer wants "absent" or a real value.
 */

import { z } from 'zod'

export const SettingsFormSchema = z.object({
  LOG: z.boolean(),
  LOG_LEVEL: z.string().nonempty(),
  CLAUDE_PATH: z.string().default(''),
  HOST: z.string().default(''),
  PORT: z.number().int().positive(),
  API_TIMEOUT_MS: z.number().int().nonnegative(),
  PROXY_URL: z.string().default(''),
  APIKEY: z.string().default(''),
  CUSTOM_ROUTER_PATH: z.string().default(''),
  ROUTER_MODE: z.enum(['scenario', 'preference', 'quota-aware']).default('scenario'),
  ROUTER_SHADOW: z.enum(['off', 'preference', 'quota-aware']).default('off'),
  ROUTER_ROLLOUT_PCT: z.number().int().min(0).max(100).default(100),
  CROSS_PROVIDER_FALLBACK: z.boolean().default(false)
})
export type SettingsFormInput = z.input<typeof SettingsFormSchema>
export type SettingsFormOutput = z.output<typeof SettingsFormSchema>
