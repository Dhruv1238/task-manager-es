import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppConfigProvider } from './contexts/AppConfigContext'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import './index.css'
import App from './App.tsx'

// Sandbox builds kick off the boot orchestrator (which may sign in
// anonymously + run Phase A seed) before mounting React, so the first paint
// already sees a coherent state. Production builds skip this entirely —
// dead-code-eliminated by the __IS_SANDBOX__ define.
async function bootstrap() {
  if (__IS_SANDBOX__) {
    const { initSandboxBoot } = await import('./lib/sandboxBoot')
    // Always start the boot waiter — for a returning Google-authed visitor
    // it picks up the cached uid and runs Phase A (which re-seeds _meta if
    // missing, e.g. after a manual Firestore wipe). For a first-time visitor
    // it parks until the SandboxLogin form fires anon sign-in or Google
    // sign-in. If we have a pending email from a previous in-flight email
    // entry, pass it through so anon sign-in can kick off immediately.
    const pendingEmail = localStorage.getItem('sandbox:pendingEmail') || undefined
    const pendingName = localStorage.getItem('sandbox:pendingName') || undefined
    void initSandboxBoot(pendingEmail ? { pendingEmail, pendingName } : undefined)
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <AppConfigProvider>
              <App />
            </AppConfigProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </StrictMode>,
  )
}

void bootstrap()
