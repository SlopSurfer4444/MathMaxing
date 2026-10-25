import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ base: process.env.VITE_APP_BASE || '/', plugins: [react()], server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:4317' } } })
