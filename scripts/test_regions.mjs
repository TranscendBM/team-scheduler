// 驗證 planner 依負責區域讀取 + 只能結案
import { readFileSync } from 'node:fs'
import { initializeApp as ai, cert } from 'firebase-admin/app'
import { getAuth as aa } from 'firebase-admin/auth'
import { getFirestore as adb, FieldValue } from 'firebase-admin/firestore'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithCustomToken } from 'firebase/auth'
import { getFirestore, doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'

const SA = process.env.SA
const cred = JSON.parse(readFileSync(SA, 'utf8'))
ai({ credential: cert(cred) })
const admin = adb()
const cfg = { apiKey: 'AIzaSyD4EPsYv0QDVjtV7zrgGkiwAiVDvMbBd1c', authDomain: 'team-scheduler-dc7ce.firebaseapp.com', projectId: 'team-scheduler-dc7ce' }
const PLANNER = 'qa.planner@example.com'

let pass = 0, fail = 0
async function expect(label, want, fn) {
  try { const r = await fn(); if (want) { console.log('✅', label, r !== undefined ? '→ ' + r : ''); pass++ } else { console.log('❌ 應被擋卻成功:', label); fail++ } }
  catch (e) { if (!want) { console.log('✅', label, '(被擋:', (e.code || e.message) + ')'); pass++ } else { console.log('❌', label, '→', e.code || e.message); fail++ } }
}

// 建暫時 planner（負責 SD1）+ 兩筆需求
await admin.collection('users').doc(PLANNER).set({ email: PLANNER, role: 'planner', active: true, regions: ['SD1'] })
const rSD1 = await admin.collection('requests').add({ projectName: 'SD1案', region: 'SD1', status: 'reviewing', submittedBy: 'someone@x.com', assignedDesigner: 'asukahsieh@gmail.com', docTypes: ['Banner'], dueDate: '2026-08-01' })
const rHQ = await admin.collection('requests').add({ projectName: 'HQ案', region: 'HQ', status: 'reviewing', submittedBy: 'someone@x.com', assignedDesigner: 'asukahsieh@gmail.com', docTypes: ['Banner'], dueDate: '2026-08-01' })

const token = await aa().createCustomToken('t-planner', { email: PLANNER })
const app = initializeApp(cfg, 'p'); await signInWithCustomToken(getAuth(app), token)
const cdb = getFirestore(app)

await expect('planner 讀負責區域(SD1)需求', true, async () => (await getDoc(doc(cdb, 'requests', rSD1.id))).data().projectName)
await expect('planner 讀非負責區域(HQ)需求', false, async () => (await getDoc(doc(cdb, 'requests', rHQ.id))).data())
await expect('planner 把 SD1 需求結案', true, async () => { await updateDoc(doc(cdb, 'requests', rSD1.id), { status: 'completed', completedAt: serverTimestamp() }); return 'completed' })
await expect('planner 改 SD1 需求為 in_progress(非結案)', false, async () => { await updateDoc(doc(cdb, 'requests', rSD1.id), { status: 'in_progress' }) })

// 清理
await admin.collection('users').doc(PLANNER).delete()
await admin.collection('requests').doc(rSD1.id).delete()
await admin.collection('requests').doc(rHQ.id).delete()
console.log(`\n結果:${pass} 通過, ${fail} 失敗`)
process.exit(fail ? 1 : 0)
