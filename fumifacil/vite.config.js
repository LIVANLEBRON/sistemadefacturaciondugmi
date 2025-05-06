import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { vitePwaConfiguration } from './src/utils/offline/pwaConfig';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA(vitePwaConfiguration)
  ],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'mui-vendor': [
            '@mui/material',
            '@mui/icons-material',
            '@mui/lab',
            '@mui/x-data-grid',
            '@mui/x-date-pickers',
            '@emotion/react',
            '@emotion/styled'
          ],
          'firebase-vendor': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage', 'firebase/functions'],
          'chart-vendor': ['chart.js', 'react-chartjs-2'],
          'form-vendor': ['react-hook-form', 'yup', '@hookform/resolvers/yup'],
          'pdf-vendor': ['jspdf', 'jspdf-autotable'],
          'utils-vendor': ['date-fns', 'uuid', 'axios']
        }
      }
    }
  }
});
