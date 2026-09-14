import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // Cloud Functions are CommonJS running on Node, not ES modules in a
    // browser. Linted as the latter, every `exports.foo = …` in
    // functions/index.js reads as an undefined global — five errors that were
    // never bugs, sitting in the output where a real one would have to be
    // noticed. `require` and `process` are the same story.
    files: ['functions/**/*.js'],
    languageOptions: {
      globals: globals.node,
      parserOptions: { sourceType: 'commonjs' },
    },
  },
])
