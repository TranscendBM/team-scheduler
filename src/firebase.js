import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// 設定改為讀環境變數（本機用 .env、CI 用 GitHub Secrets）。
// 若環境變數未設定，暫時 fallback 到舊專案，確保移轉期間不會壞掉。
// 移轉完成後，舊的 fallback 值可以移除。
const env = import.meta.env
const firebaseConfig = {
  apiKey:            env.VITE_FIREBASE_API_KEY            || "AIzaSyDHwHfqzXgQRcQDOSrNPUSxXMZV_bpeV8g",
  authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN        || "team-scheduler-97c89.firebaseapp.com",
  projectId:         env.VITE_FIREBASE_PROJECT_ID         || "team-scheduler-97c89",
  storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET     || "team-scheduler-97c89.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "473406109192",
  appId:             env.VITE_FIREBASE_APP_ID             || "1:473406109192:web:af5868555ea935467d83bd",
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()
