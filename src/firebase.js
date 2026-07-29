import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'

// 設定一律讀環境變數（本機用 .env、CI/正式 build 用 secrets 注入）。
// 刻意「不」提供任何舊專案 fallback：一旦缺少必要變數，寧可讓 build/啟動直接失敗，
// 也不要讓程式悄悄連到錯的 Firebase 專案、誤寫舊資料庫。
const REQUIRED_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

const env = import.meta.env
const missing = REQUIRED_KEYS.filter((k) => !env[k])

if (missing.length > 0) {
  const message =
    `[firebase.js] 缺少必要的環境變數：${missing.join(', ')}\n` +
    '請建立 .env（可複製 .env.example）並填入 Firebase 專案設定，' +
    '或確認部署環境已注入這些變數。系統拒絕在設定不完整的情況下啟動，' +
    '以避免誤連到錯誤的 Firebase 專案。'
  // 開發模式：拋出讓畫面直接顯示錯誤，避免以為「連上了」但其實連錯專案。
  // 若未來改用其他建置管線導致 import.meta.env 不可靠，這裡仍會是最後一道防線。
  throw new Error(message)
}

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
export const functions = getFunctions(app, 'asia-east1')
export const googleProvider = new GoogleAuthProvider()
