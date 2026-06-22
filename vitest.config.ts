import { defineConfig } from 'vitest/config'
import path from 'path'

// Mirrors the "@/*" -> "./src/*" alias from tsconfig.json so test files can import
// production code (e.g. '@/lib/chunk-extractor') exactly the way the app does.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
