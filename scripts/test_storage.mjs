// 驗證 Storage 上傳:已登入可上傳小檔並取得下載連結、>10MB 被擋、未登入被擋
import { readFileSync } from 'node:fs'
import { initializeApp as ai, cert } from 'firebase-admin/app'
import { getAuth as aa } from 'firebase-admin/auth'
import { getStorage as adminStorage } from 'firebase-admin/storage'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithCustomToken } from 'firebase/auth'
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage'

const SA = process.env.SA
const cred = JSON.parse(readFileSync(SA, 'utf8'))
ai({ credential: cert(cred), storageBucket: 'team-scheduler-dc7ce.firebasestorage.app' })
const cfg = { apiKey: 'AIzaSyD4EPsYv0QDVjtV7zrgGkiwAiVDvMbBd1c', authDomain: 'team-scheduler-dc7ce.firebaseapp.com', projectId: 'team-scheduler-dc7ce', storageBucket: 'team-scheduler-dc7ce.firebasestorage.app' }

const path = 'attachments/__test__/hello.txt'

// 未登入
const anon = getStorage(initializeApp(cfg, 'anon'))
try { await uploadBytes(ref(anon, path), new Uint8Array([1, 2, 3])); console.log('❌ 未登入竟能上傳') }
catch (e) { console.log('✅ 未登入上傳被擋:', e.code) }

// 已登入(manager)
const token = await aa().createCustomToken('t-mgr', { email: 'tselvis814@gmail.com' })
const app = initializeApp(cfg, 'mgr'); await signInWithCustomToken(getAuth(app), token)
const st = getStorage(app)

try {
  await uploadBytes(ref(st, path), new TextEncoder().encode('hello attachment'))
  const url = await getDownloadURL(ref(st, path))
  console.log('✅ 已登入上傳成功,下載連結:', url.slice(0, 70) + '…')
} catch (e) { console.log('❌ 已登入上傳失敗:', e.code || e.message) }

// >10MB 應被擋
try {
  await uploadBytes(ref(st, 'attachments/__test__/big.bin'), new Uint8Array(11 * 1024 * 1024))
  console.log('❌ >10MB 竟能上傳')
} catch (e) { console.log('✅ >10MB 上傳被擋:', e.code) }

// 清理
await adminStorage().bucket().deleteFiles({ prefix: 'attachments/__test__/' })
console.log('🧹 已清理測試檔')
process.exit(0)
