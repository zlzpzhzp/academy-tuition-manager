import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    // 루트 __tests__/ 와 src/__tests__/ 둘 다 잡는다.
    // (기존 '__tests__/**' 는 루트만 매칭 → src/__tests__ 70테스트가 통째 스킵돼 false green 이었음)
    include: ['**/__tests__/**/*.test.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
