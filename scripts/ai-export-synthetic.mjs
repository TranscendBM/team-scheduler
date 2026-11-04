#!/usr/bin/env node
// AI 資料表：用「合成(假)資料」驗證同步流程。不讀正式 Firestore、不用正式 HMAC 密鑰。
//
// 預設(dry-run)：只在本機產生快照，印出摘要，並把各分頁內容寫成本機 JSON 檔供檢查。完全不連任何服務。
//   node scripts/ai-export-synthetic.mjs [--out=<檔案路徑>]
//
// 寫入測試用的 Google Sheet(第 10 步「先用合成資料確認 Google Sheets 讀取正常」)：
//   1) 建一份「測試用」的私人 Sheet(不要用正式那份)，只分享給你自己
//   2) 本機登入 Google(使用你自己的帳號，不產生任何金鑰檔)：
//        gcloud auth application-default login --scopes=https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/cloud-platform
//   3) node scripts/ai-export-synthetic.mjs --write --sheet-id=<測試 Sheet 的 ID>
// 寫入的內容全部是合成資料；來源資料裡刻意放了「敏感哨兵字串」(假的 email、附件、預算…)，
// 輸出若出現它們就代表外洩，腳本會檢查並失敗。
import { writeFileSync } from 'node:fs'
import { buildSnapshot, TAB, DATA_TABS } from '../functions/aiExport.js'
import { syncToSheet, createSheetsClient } from '../functions/aiExportSync.js'
import { KEY, NOW, SENTINELS, users, people, requests, projects } from '../functions/test/helpers/aiExportFixtures.js'

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v ?? true]
}))

const now = args.now ? new Date(args.now) : NOW
// 第一階段預設不含專案(AI_Projects 只有表頭)；加 --with-projects 才會用合成專案資料測試該分頁
const snapshot = buildSnapshot({ requests, projects, users, people, now, hmacKey: KEY, anonymize: true, includeProjects: !!args['with-projects'] })

// 外洩檢查：任何哨兵字串、email、網址出現在輸出中就失敗
const text = JSON.stringify(snapshot.tabs)
const leaked = SENTINELS.filter((s) => text.includes(s))
if (leaked.length || /@/.test(text) || /https?:/i.test(text)) {
  console.error('✖ 合成資料驗證失敗：輸出含有不該出現的內容', leaked)
  process.exit(1)
}

console.log('合成資料快照(synthetic，與正式資料無關)')
console.log(`  snapshotId   : ${snapshot.snapshotId}`)
console.log(`  schemaVersion: ${snapshot.schemaVersion}`)
console.log(`  requests     : ${snapshot.counts.requests}   projects: ${snapshot.counts.projects}`)
console.log('  rows per tab :', Object.fromEntries(DATA_TABS.map((t) => [t, snapshot.tabs[t].length])))
console.log('  stats        :', JSON.stringify(snapshot.stats))
console.log('  top3 risks   :', snapshot.risks.map((r) => `${r.rank}.${r.id}[${r.reasons.join('+')}]`).join('  '))
console.log('✔ 外洩檢查通過(沒有 email、網址或敏感哨兵字串)')

const out = typeof args.out === 'string' ? args.out : null
if (out) {
  writeFileSync(out, JSON.stringify(snapshot.tabs, null, 2), 'utf8')
  console.log(`  已把各分頁內容寫到 ${out}`)
}

if (!args.write) {
  console.log('\n(dry-run：沒有連線任何服務。要寫入測試 Sheet 請加 --write --sheet-id=<ID>)')
  process.exit(0)
}

const sheetId = typeof args['sheet-id'] === 'string' ? args['sheet-id'] : ''
if (!sheetId) {
  console.error('✖ --write 需要 --sheet-id=<測試 Sheet 的 ID>')
  process.exit(1)
}
console.log(`\n寫入測試 Sheet(${sheetId.slice(0, 6)}…)，使用本機 Application Default Credentials`)
const sheets = await createSheetsClient(sheetId)
const res = await syncToSheet({ sheets, snapshot, now })
console.log('✔ 寫入並讀回驗證完成：', JSON.stringify(res))
console.log(`  請到 Sheet 確認分頁：${[...DATA_TABS, TAB.STATUS].join('、')}，且 ${TAB.STATUS} 的 status = OK`)
