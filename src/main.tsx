import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Replacing the sphere's texture leaves Photo Sphere Viewer with an image load
// it no longer wants, and it aborts it without catching the rejection. Every
// stage switch would otherwise log an error the page cannot act on. Only
// AbortError is swallowed, so a real failure still reaches the console.
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as { name?: string } | null
  if (reason?.name === 'AbortError') event.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
