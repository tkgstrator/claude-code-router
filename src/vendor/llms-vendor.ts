// @ts-nocheck
/**
 * Bun-executable stub for the vendored @musistudio/llms modules.
 * tsconfig maps every `@/llms/*` import here so tsc treats them as `any`,
 * keeping llms' latent type errors out of our strict typecheck.
 * Vite resolves `@/llms/*` to the real source at runtime via its own alias.
 * This file satisfies Bun's test runner, which executes tsconfig path targets.
 *
 * All named exports used by src/llmsContext.ts are listed here so Bun's
 * strict ESM named-export checker does not raise a SyntaxError.
 */

// biome-ignore lint/suspicious/noExplicitAny: intentional any stub
export const handleTransformerEndpoint: any = () => {}
// biome-ignore lint/suspicious/noExplicitAny: intentional any stub
export const ConfigService: any = class {}
// biome-ignore lint/suspicious/noExplicitAny: intentional any stub
export const ProviderService: any = class {}
// biome-ignore lint/suspicious/noExplicitAny: intentional any stub
export const TokenizerService: any = class {}
// biome-ignore lint/suspicious/noExplicitAny: intentional any stub
export const TransformerService: any = class {}
// biome-ignore lint/suspicious/noExplicitAny: intentional any stub
export const router: any = () => {}
