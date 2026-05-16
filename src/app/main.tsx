import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const App = () => (
  <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
    <h1>CCR — Hono + Vite root</h1>
    <p>
      Phase 1a placeholder. The legacy UI still lives in <code>packages/ui</code>; this entry exists so the new root has
      both a Hono server and a Vite-served React boot point in place.
    </p>
  </main>
)

const container = document.getElementById('root')
if (!container) throw new Error('#root element missing from index.html')
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
