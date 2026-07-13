// 用 custom token 模擬 manager 登入，實測 client SDK 在真實規則下能讀什麼
import { readFileSync } from 'node:fs'
import { initializeApp as adminInit, cert } from 'firebase-admin/app'
import { getAuth as adminAuth } from 'firebase-admin/auth'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithCustomToken } from 'firebase/auth'
import { getFirestore, doc, getDoc, collection, getDocs } from 'firebase/firestore'

const SA = process.env.SA
const EMAIL = (process.env.EMAIL || 'tselvis814@gmail.com').toLowerCase()
const cred = JSON.parse(readFileSync(SA, 'utf8'))

// admin 造 custom token（帶 email claim）
adminInit({ credential: cert(cred) })
const token = await adminAuth().createCustomToken('test-' + EMAIL, { email: EMAIL })

// client 登入
const webConfig = {
  apiKey: 'AIzaSyD4EPsYv0QDVjtV7zrgGkiwAiVDvMbBd1c',
  authDomain: 'team-scheduler-dc7ce.firebaseapp.com',
  projectId: 'team-scheduler-dc7ce',
}
const app = initializeApp(webConfig)
const auth = getAuth(app)
const db = getFirestore(app)
const uc = await signInWithCustomToken(auth, token)
const tok = await uc.user.getIdTokenResult()
console.log('登入身分 token.email =', tok.claims.email)

async function tryRead(label, fn) {
  try { const r = await fn(); console.log('✅', label, '→ OK', r) }
  catch (e) { console.log('❌', label, '→', e.code || e.message) }
}

await tryRead('讀自己的 users 文件', async () => {
  const s = await getDoc(doc(db, 'users', EMAIL)); return s.exists() ? s.data().role : '(不存在)'
})
await tryRead('讀 projects collection', async () => {
  const s = await getDocs(collection(db, 'projects')); return s.size + ' 筆'
})
await tryRead('讀 people collection', async () => {
  const s = await getDocs(collection(db, 'people')); return s.size + ' 筆'
})
process.exit(0)
