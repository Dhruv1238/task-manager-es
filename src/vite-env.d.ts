/// <reference types="vite/client" />

// Vite `define`-injected literal. True only in `vite build --mode sandbox` /
// `vite --mode sandbox` builds. Compared as a bare identifier so production
// builds inline `false` and tree-shake every gated branch.
declare const __IS_SANDBOX__: boolean

interface ImportMetaEnv {
  readonly VITE_IS_SANDBOX?: string
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  readonly VITE_FIREBASE_STORAGE_BUCKET: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string
  readonly VITE_FIREBASE_APP_ID: string
  readonly VITE_FIREBASE_MEASUREMENT_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
