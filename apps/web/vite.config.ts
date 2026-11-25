import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Staging/dev hosts can be supplied explicitly when needed; no tunnel host is
// allowed by default.
const extraHosts = (process.env.VITE_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ['localhost', ...extraHosts],
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
