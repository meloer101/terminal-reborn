import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['.claude/', 'out/', 'dist/', 'release/', 'node_modules/', 'coverage/', 'test-results/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/main/**', 'src/preload/**', 'src/pty-host/**', 'e2e/**', 'e2e-packaged/**', 'scripts/*.mjs', '*.config.*'],
    languageOptions: { globals: globals.node }
  },
  {
    // Build-time CommonJS helpers (electron-builder hooks, icon rendering).
    files: ['build/**/*.cjs', 'scripts/**/*.cjs'],
    languageOptions: { globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  {
    files: ['src/renderer/**'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  }
)
