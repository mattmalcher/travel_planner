import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/', 'playwright-report/', 'test-results/'] },
  js.configs.recommended,
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
    },
  },
  {
    // Browser app code (bundled by scripts/build.mjs). L is Leaflet, loaded
    // from a CDN script tag.
    files: ['src/**/*.js'],
    languageOptions: { globals: { ...globals.browser, L: 'readonly' } },
  },
  {
    // The service worker runs in a worker scope, not a window.
    files: ['src/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.js', '*.config.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
];
