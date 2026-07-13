#!/usr/bin/env node
/**
 * 一次性種入初始使用者（白名單）到 Firestore users collection。
 * doc id = 小寫 email。用 Admin SDK 寫入（繞過 security rules）。
 *
 * 用法：
 *   MANAGER_EMAIL=you@gmail.com MANAGER_NAME=你的名字 \
 *   SA=/path/new-sa.json node scripts/seed_users.mjs
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const SA = process.env.SA
const MANAGER_EMAIL = (process.env.MANAGER_EMAIL || '').toLowerCase()
const MANAGER_NAME = process.env.MANAGER_NAME || '設計主管'
if (!SA || !MANAGER_EMAIL) {
  console.error('❌ 請設定 SA=service account 路徑 與 MANAGER_EMAIL=你的登入 email')
  process.exit(1)
}

const cred = JSON.parse(readFileSync(SA, 'utf8'))
const db = getFirestore(initializeApp({ credential: cert(cred) }))

const seed = [
  { email: MANAGER_EMAIL, displayName: MANAGER_NAME, role: 'manager', active: true, notifyEmail: process.env.MANAGER_NOTIFY || '' },
  { email: 'asukahsieh@gmail.com', displayName: 'Sherry', role: 'designer', active: true, notifyEmail: 'sherry_hsieh@transcend-info.com' },
  { email: 'tingwei135@gmail.com', displayName: 'Tingwei', role: 'designer', active: true, notifyEmail: 'tingwei_yeh@transcend-info.com' },
  { email: 'yunatsao.office@gmail.com', displayName: 'Yuna', role: 'designer', active: true, notifyEmail: 'yuna_tsao@transcend-info.com' },
]

for (const u of seed) {
  const id = u.email.toLowerCase()
  await db.collection('users').doc(id).set(u, { merge: true })
  console.log(`  ✅ ${id} → ${u.role}`)
}
console.log(`\n完成：種入 ${seed.length} 位使用者`)
