import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // La couverture unitaire cible le domaine (src/lib). Les composants et
      // les parcours d’interface sont couverts par les tests Playwright.
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts', 'src/lib/__fixtures__/**'],
      // Seuils bloquants, légèrement sous la couverture constatée en 0.14.2.
      // Ils empêchent une régression silencieuse sans rendre la CI fragile.
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 83,
        lines: 83,
        'src/lib/crypto.ts': {
          statements: 68,
          branches: 50,
          functions: 83,
          lines: 67,
        },
        'src/lib/vault.ts': {
          statements: 83,
          branches: 68,
          functions: 87,
          lines: 85,
        },
        'src/lib/import.ts': {
          statements: 82,
          branches: 72,
          functions: 98,
          lines: 86,
        },
      },
    },
  },
})
