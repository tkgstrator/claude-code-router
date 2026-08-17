/**
 * Compact Input wrapper.
 *
 * Re-exports the shadcn `Input` (managed in `src/components/ui/input.tsx`,
 * which must only be updated via `bunx shadcn@latest add`) with a smaller
 * default height / padding / text-size so form fields don't dominate
 * their surrounding rows. tailwind-merge inside `cn()` handles overriding
 * the base classes safely — callers can still pin `h-9` / `text-base` /
 * etc. via `className` for the rare full-size case.
 *
 * All callsites import Input from here; the shadcn source stays
 * unmodified so a future `shadcn add input --overwrite` still round-trips
 * cleanly.
 */

import type * as React from 'react'
// biome-ignore plugin: import rename is the only mechanism to shadow the
// shadcn-managed `Input` export while re-exposing our compacted wrapper
// under the same name; the plugin's `as`-avoidance rule targets value-
// level type assertions, not import specifiers.
import { Input as BaseInput } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <BaseInput className={cn('h-8 px-2 py-0.5 text-sm', className)} {...props} />
}
