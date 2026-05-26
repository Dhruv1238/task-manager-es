import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// We bake `VITE_IS_SANDBOX` into the bundle as the build-time literal
// `__IS_SANDBOX__` so production builds tree-shake every sandbox-only branch
// (PersonaSwitcher, TourOverlay, capture coordinator, etc.). The value comes
// from whichever `.env` file the developer has loaded — Vite's standard env
// resolution is the source of truth; we don't depend on `--mode` flags.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isSandbox = env.VITE_IS_SANDBOX === 'true'
  return {
    plugins: [react()],
    define: {
      __IS_SANDBOX__: JSON.stringify(isSandbox),
    },
  }
})
