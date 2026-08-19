import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// В разработке фронт живёт отдельно и ходит в бэкенд через прокси;
// в сборке бэкенд раздаёт dist сам, поэтому базовый путь остаётся корневым.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:5174' },
  },
  build: { outDir: 'dist', sourcemap: false },
});
