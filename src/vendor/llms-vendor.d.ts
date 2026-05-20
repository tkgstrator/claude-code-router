/**
 * Type-only stub for the vendored @musistudio/llms code under
 * src/vendor/llms. tsconfig maps `@/llms/*` here so the strict root
 * typecheck treats the (intentionally loose, esbuild-bundled) llms
 * modules as `any` instead of pulling their ~25 latent type errors
 * into our program. Vite resolves `@/llms/*` to the real source at
 * runtime via its own alias — this only affects `tsc`.
 */
declare const llmsAny: any
export = llmsAny
