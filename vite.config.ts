import { fileURLToPath, URL } from 'node:url'
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
    resolve: {
      alias: [
        // Firestore usage watchdog: every `import ... from 'firebase/firestore'`
        // (107 files) resolves to the instrumented facade, which re-exports the
        // real SDK from '@firebase/firestore' (the exact module the shim itself
        // re-exports — single instance, see versionLock.test.ts). Regex is
        // EXACT-match on purpose: a plain string key would also prefix-rewrite
        // 'firebase/firestore/lite'. Mirrored by `paths` in tsconfig.app.json
        // so tsc typechecks consumers against the facade. Vitest inherits this
        // via vite.config.ts. Revert = delete this entry + the paths mapping.
        {
          find: /^firebase\/firestore$/,
          replacement: fileURLToPath(new URL('./src/lib/fsIntercept.ts', import.meta.url)),
        },
      ],
    },
    // NO build.sourcemap here, deliberately. `sourcemap: 'hidden'` was tried
    // so clientOpsReports stacks could be symbolicated — it omits the
    // sourceMappingURL comment but STILL writes dist/assets/*.js.map with
    // full `sourcesContent`, and dist/ is uploaded wholesale to a static host
    // with no ignore globs anywhere (firebase.json has no hosting block, and
    // there's no netlify.toml/_headers), so every .map would be publicly
    // fetchable at a guessable URL. Minified chunk + line/col in the reports
    // is enough to locate a call site. If you ever want true symbolication,
    // generate maps in a separate build whose output never enters dist/, or
    // upload them to a private error-tracking service and delete them before
    // deploy — then verify a .map URL 404s against the live host.
    define: {
      __IS_SANDBOX__: JSON.stringify(isSandbox),
    },
  }
})
