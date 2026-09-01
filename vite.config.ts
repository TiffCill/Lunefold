import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { companionPlugin } from './server/plugin.ts';

export default defineConfig({
  plugins: [companionPlugin(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
});
