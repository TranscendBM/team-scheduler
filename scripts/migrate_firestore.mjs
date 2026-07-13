#!/usr/bin/env node
/**
 * Firestore 資料搬遷：舊專案 → 新專案
 *
 * 用法：
 *   OLD_SA=/path/old-serviceAccount.json \
 *   NEW_SA=/path/new-serviceAccount.json \
 *   node scripts/migrate_firestore.mjs [--dry-run]
 *
 * - 自動抓取「所有」top-level collections（listCollections），並遞迴複製子集合。
 * - 保留原本的 document ID。
 * - --dry-run 只統計數量、不寫入。
 *
 * 需先安裝：npm i firebase-admin（或在乾淨資料夾 npx 執行）。
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const OLD_SA = process.env.OLD_SA
const NEW_SA = process.env.NEW_SA
const DRY_RUN = process.argv.includes('--dry-run')

if (!OLD_SA || !NEW_SA) {
  console.error('❌ 請設定環境變數 OLD_SA 與 NEW_SA（指向兩個 service account JSON 檔）')
  process.exit(1)
}

const oldCred = JSON.parse(readFileSync(OLD_SA, 'utf8'))
const newCred = JSON.parse(readFileSync(NEW_SA, 'utf8'))

const oldApp = initializeApp({ credential: cert(oldCred) }, 'old')
const newApp = initializeApp({ credential: cert(newCred) }, 'new')
const srcDb = getFirestore(oldApp)
const dstDb = getFirestore(newApp)

let docCount = 0
let colCount = 0

// 遞迴複製一個 collection reference（含每份文件底下的子集合）
async function copyCollection(srcColRef, dstColRef) {
  colCount++
  const snap = await srcColRef.get()
  console.log(`  📁 ${srcColRef.path} — ${snap.size} 筆`)
  for (const docSnap of snap.docs) {
    docCount++
    const dstDocRef = dstColRef.doc(docSnap.id)
    if (!DRY_RUN) await dstDocRef.set(docSnap.data())
    // 遞迴子集合
    const subCols = await docSnap.ref.listCollections()
    for (const sub of subCols) {
      await copyCollection(sub, dstDocRef.collection(sub.id))
    }
  }
}

async function main() {
  console.log(`來源專案：${oldCred.project_id}`)
  console.log(`目標專案：${newCred.project_id}`)
  console.log(DRY_RUN ? '模式：DRY-RUN（不寫入）\n' : '模式：實際寫入\n')

  const topCols = await srcDb.listCollections()
  if (topCols.length === 0) {
    console.log('來源沒有任何 collection。')
    return
  }
  for (const col of topCols) {
    await copyCollection(col, dstDb.collection(col.id))
  }

  console.log(`\n✅ 完成：${colCount} 個集合、${docCount} 份文件${DRY_RUN ? '（未寫入）' : ''}`)
}

main().catch(e => { console.error('❌ 搬遷失敗：', e); process.exit(1) })
