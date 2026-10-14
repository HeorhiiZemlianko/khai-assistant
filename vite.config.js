import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/khai-assistant/', // <-- Добавьте эту строку
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx']
  }
})
