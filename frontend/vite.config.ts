import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// OpenAtlas frontend: Vite dev port 3381, proxy /api → OpenAtlas backend.
// (OpenAtlas backend then proxies /api to Hermes dev gateway 58642)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const backendTarget =
    env.VITE_API_PROXY_TARGET
    || env.OPENATLAS_API_PROXY_TARGET
    || `http://127.0.0.1:${env.OPENATLAS_BACKEND_PORT || '58003'}`;

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('/@xyflow/') || id.includes('/elkjs/')) return 'vendor-canvas';
            if (id.includes('/@shikijs/core/') || id.includes('/@shikijs/engine-javascript/')) return 'vendor-shiki-core';
            if (id.includes('/@shikijs/themes/')) return 'vendor-shiki-themes';
            if (id.includes('/shiki/')) return 'vendor-shiki-core';
            if (id.includes('/@codesandbox/')) return 'vendor-sandpack';
            if (id.includes('/streamdown/')) return 'vendor-streamdown';
            if (id.includes('/katex/')) return 'vendor-katex';
            if (id.includes('/marked/')) return 'vendor-marked';
            if (id.includes('/antd/') || id.includes('/@ant-design/')) return 'vendor-antd';
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router-dom/')) {
              return 'vendor-react';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      host: true,        // listen on 0.0.0.0 (IPv4) + IPv6 — fixes localhost access on some networks
      port: 3381,
      strictPort: true,
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
          secure: false,
          ws: false,
        },
      },
    },
  };
})
