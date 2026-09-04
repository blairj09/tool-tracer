import { defineConfig } from 'vitest/config'

// Separate config so scripts/ "tests" (utilities) never run under `npm test`.
export default defineConfig({
  test: { environment: 'node', include: ['scripts/**/*.test.ts'], testTimeout: 60000 },
})
