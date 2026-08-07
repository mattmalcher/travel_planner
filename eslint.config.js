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
    // from a CDN script tag; __H_FORM_SPEC__ and __H_SCHEMA_TEXT__ are
    // substituted at build time by esbuild's define (see src/form-spec.js and
    // src/validate.js).
    files: ['src/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser, L: 'readonly',
        __H_FORM_SPEC__: 'readonly', __H_SCHEMA_TEXT__: 'readonly',
      },
    },
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
  {
    // E2E specs are two scopes in one file: the spec runs in node, and the
    // callbacks handed to page.evaluate run in the browser. Most reach browser
    // APIs through `globalThis.`, but a constructor (DataTransfer, DragEvent,
    // ClipboardEvent) has to be named bare, so the browser globals belong here
    // as well as node's.
    files: ['tests/e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
