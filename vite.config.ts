import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite configuration for React + TypeScript.
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'esnext'
  }
})