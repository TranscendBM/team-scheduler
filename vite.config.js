import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const REQUIRED_FIREBASE_ENV = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

export default defineConfig(({ command, mode }) => {
  // 正式 build（npm run build）前先驗證必要的 Firebase 環境變數是否齊全，
  // 缺少就直接讓 build 失敗，避免打包出一份會 fallback 到錯誤專案（或直接壞掉）的產物並被部署出去。
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), '')
    const missing = REQUIRED_FIREBASE_ENV.filter((k) => !env[k])
    if (missing.length > 0) {
      throw new Error(
        `[vite.config.js] 缺少必要的環境變數，停止建置：${missing.join(', ')}\n` +
        '請設定 .env（可複製 .env.example）或在部署環境注入這些變數後再重新 build。'
      )
    }
  }

  return {
    plugins: [react()],
    base: process.env.VITE_BASE_PATH || '/',
  }
})
