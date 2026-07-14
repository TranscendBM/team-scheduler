#!/usr/bin/env node
/**
 * 一次性匯入:原 Google Sheet「設計師工作列表」CSV → Firestore requests
 * 用法:SA=/path/sa.json CSV=/path/file.csv node scripts/import_sheet.mjs [--dry-run]
 *
 * 對照(2026-07 與 Elvis 確認):
 *   狀態 Check→reviewing、Design→in_progress、空白→assigned
 *   提案/附件(Google 連結)不匯入;交期補 2026 年;每筆標 source:'sheet-import'
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const SA = process.env.SA
const CSV = process.env.CSV
const DRY = process.argv.includes('--dry-run')
if (!SA || !CSV) { console.error('請設定 SA= 與 CSV='); process.exit(1) }

const DESIGNERS = {
  Tingwei: { email: 'tingwei135@gmail.com', name: 'Tingwei' },
  Yuna: { email: 'yunatsao.office@gmail.com', name: 'Yuna' },
  Sherry: { email: 'asukahsieh@gmail.com', name: 'Sherry' },
}
const PLANNERS = {
  Ecco: 'ecco_lin@transcend-info.com',
  Ashley: 'ashley_lin@transcend-info.com',
  Rachel: 'rachel_lin@transcend-info.com',
  Shinpei: 'shinpei_liu@transcend-info.com',
  Elvis: 'tselvis814@gmail.com',
}
const STATUS_MAP = { Check: 'reviewing', Design: 'in_progress', '': 'assigned' }

// 簡易 CSV 解析(支援雙引號含逗號)
function parseCsv(text) {
  const rows = []
  let row = [], cur = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') inQ = false
      else cur += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cur); rows.push(row); row = []; cur = ''
    } else cur += c
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows
}

function toDueDate(v) {
  const m = (v || '').trim().match(/^(\d{1,2})\/(\d{1,2})$/)
  if (!m) return ''
  return `2026-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

const cred = JSON.parse(readFileSync(SA, 'utf8'))
const db = getFirestore(initializeApp({ credential: cert(cred) }))

const rows = parseCsv(readFileSync(CSV, 'utf8'))
const header = rows[0]
console.log('欄位:', header.join(' | '))

let n = 0, skipped = 0
for (const r of rows.slice(1)) {
  const [status, designer, planner, urgent, region, projectName, docTypes, due] = r.map(x => (x || '').trim())
  if (!projectName || !projectName.replace(/\s/g, '')) { skipped++; continue }

  const dz = DESIGNERS[designer]
  const doc = {
    projectName,
    region: region || '',
    urgent: urgent.includes('急件'),
    docTypes: docTypes ? docTypes.split(',').map(s => s.trim()).filter(Boolean) : [],
    dueDate: toDueDate(due),
    description: (r[11] || '').trim(),
    attachments: [],
    status: STATUS_MAP[status] ?? 'assigned',
    assignedDesigners: dz ? [dz.email] : [],
    assignedDesignersNames: dz ? [dz.name] : (designer ? [designer] : []),
    submittedBy: PLANNERS[planner] || '',
    submittedByName: planner || '',
    createdAt: FieldValue.serverTimestamp(),
    source: 'sheet-import',
  }
  n++
  console.log(`${DRY ? '[dry]' : '[寫入]'} ${doc.status.padEnd(11)} ${designer.padEnd(8)} ${projectName.slice(0, 45)}`)
  if (!DRY) await db.collection('requests').add(doc)
}
console.log(`\n完成:${n} 筆${DRY ? '(未寫入)' : ''},略過空白列 ${skipped}`)
process.exit(0)
