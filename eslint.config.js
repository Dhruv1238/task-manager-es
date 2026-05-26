import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// AST selector for direct Firestore refs we want to forbid:
//   collection(db, ...) | doc(db, ...) | getDoc(doc(db, ...)) etc.
// Anything where `db` (or `auth`+ raw firestore primitives) is passed as the
// first arg to `collection` / `doc`. Use tenantCol / tenantDoc from
// src/lib/firestore.ts instead — they path-prefix in sandbox mode and pass
// through in production. The helpers themselves are exempted via the file-
// scoped override below.
const NO_DIRECT_FIRESTORE_REFS = {
  selector:
    "CallExpression[callee.name=/^(collection|doc)$/][arguments.0.type='Identifier'][arguments.0.name='db']",
  message:
    'Use tenantCol() / tenantDoc() from src/lib/firestore.ts instead of direct collection(db,...) or doc(db,...) calls.',
}

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'no-restricted-syntax': ['error', NO_DIRECT_FIRESTORE_REFS],
    },
  },
  {
    // The tenant helpers themselves are the one place the raw primitives are
    // allowed. Everything else routes through them.
    files: ['src/lib/firestore.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
])
