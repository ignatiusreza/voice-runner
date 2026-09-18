import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the same bundle works from a web host subpath and from the
  // `capacitor://` / `https://localhost` origins the native shells serve from.
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    host: true,
    // getUserMedia needs a secure context; localhost counts, LAN IPs do not.
    // Use `npm run dev -- --https` style tunnelling when testing on a phone.
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Only the deterministic simulation/analysis layers are gated. Rendering
      // and platform glue need a real browser and are covered manually.
      include: [
        'src/core/**/*.ts',
        'src/audio/analysis/**/*.ts',
        'src/game/**/*.ts',
        'src/input/**/*.ts',
      ],
      exclude: ['**/*.test.ts'],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});
