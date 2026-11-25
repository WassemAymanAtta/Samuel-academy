import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Temporary client-trial tunnel host. Remove the default entry after the trial,
// or override with VITE_ALLOWED_HOSTS="host1,host2" when the tunnel URL changes.
const trialHosts = (process.env.VITE_ALLOWED_HOSTS ?? 'reveler-disk-algebra.ngrok-free.dev')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ['localhost', ...trialHosts],
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
