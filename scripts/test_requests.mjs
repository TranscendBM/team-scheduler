// 驗證 requests 規則與資料流：manager 建立/指派、designer 只能讀自己被指派的且只能改狀態
import { readFileSync } from 'node:fs'
import { initializeApp as adminInit, cert } from 'firebase-admin/app'
import { getAuth as adminAuth } from 'firebase-admin/auth'
import { getFirestore as adminDb } from 'firebase-admin/firestore'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithCustomToken } from 'firebase/auth'
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where, getDocs,
} from 'firebase/firestore'

const SA = process.env.SA
const cred = JSON.parse(readFileSync(SA, 'utf8'))
adminInit({ credential: cert(cred) })

const MANAGER = 'tselvis814@gmail.com'
const DESIGNER = 'asukahsieh@gmail.com'
const webConfig = { apiKey: 'AIzaSyD4EPsYv0QDVjtV7zrgGkiwAiVDvMbBd1c', authDomain: 'team-scheduler-dc7ce.firebaseapp.com', projectId: 'team-scheduler-dc7ce' }

async function clientFor(email, name) {
  const token = await adminAuth().createCustomToken('t-' + email, { email })
  const app = initializeApp(webConfig, name)
  const uc = await signInWithCustomToken(getAuth(app), token)
  return getFirestore(app)
}

let pass = 0, fail = 0
async function expect(label, shouldSucceed, fn) {
  try { const r = await fn(); if (shouldSucceed) { console.log('✅', label, r !== undefined ? `→ ${r}` : ''); pass++ } else { console.log('❌ 應被擋卻成功：', label); fail++ } }
  catch (e) { if (!shouldSucceed) { console.log('✅', label, '(正確被擋:', (e.code||e.message)+')'); pass++ } else { console.log('❌', label, '→', e.code || e.message); fail++ } }
}

const mgr = await clientFor(MANAGER, 'mgr')
const des = await clientFor(DESIGNER, 'des')

// 1. manager 建立需求（submittedBy=自己, status=pending）
let reqId
await expect('manager 建立需求', true, async () => {
  const ref = await addDoc(collection(mgr, 'requests'),
    { title: '測試需求', description: 'x', type: '平面設計', dueDate: '', attachments: [], submittedBy: MANAGER, submittedByName: 'M', status: 'pending' })
  reqId = ref.id; return reqId
})

// 2. 建立時偽造他人 submittedBy → 應被擋
await expect('偽造 submittedBy 建立', false, async () => {
  await addDoc(collection(des, 'requests'),
    { title: '假冒', submittedBy: MANAGER, status: 'pending' })
})

// 3. planner/自己查詢自己的需求
await expect('manager 查自己送出的需求', true, async () => {
  const s = await getDocs(query(collection(mgr, 'requests'), where('submittedBy', '==', MANAGER)))
  return s.size + ' 筆'
})

// 4. designer 讀「未指派給他」的需求 → 應被擋
await expect('designer 讀未指派需求', false, async () => {
  const s = await getDoc(doc(des, 'requests', reqId)); return s.exists() ? 'got' : 'none'
})

// 5. manager 核准並指派給 designer
await expect('manager 指派設計師', true, async () => {
  await updateDoc(doc(mgr, 'requests', reqId), { status: 'assigned', assignedDesigner: DESIGNER, reviewedBy: MANAGER, reviewNote: 'ok' })
  return 'assigned'
})

// 6. designer 讀被指派的需求 → OK
await expect('designer 讀被指派需求', true, async () => {
  const s = await getDoc(doc(des, 'requests', reqId)); return s.data().status
})

// 7. designer 推進狀態 assigned→in_progress（只改 status/timestamp）→ OK
await expect('designer 推進狀態', true, async () => {
  await updateDoc(doc(des, 'requests', reqId), { status: 'in_progress', startedAt: new Date() })
  return 'in_progress'
})

// 8. designer 竄改需求內容(title) → 應被擋
await expect('designer 改需求內容', false, async () => {
  await updateDoc(doc(des, 'requests', reqId), { title: '亂改' })
})

// 清理
await adminDb().collection('requests').doc(reqId).delete()
console.log(`\n結果：${pass} 通過, ${fail} 失敗`)
process.exit(fail ? 1 : 0)
