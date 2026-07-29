#!/usr/bin/env node
/**
 * 匯入「Design行銷設計部」需求追蹤表（Excel）到 requests collection。
 * 用法：SA=/path/sa.json XLSX=/path/file.xlsx node scripts/import_requests.mjs [--dry-run]
 *
 * 欄位對照（依實際表頭）：狀態,設計師,Planner,急件,地區,專案名稱,稿件類型,交期,提案,附件,工時,備註
 * 狀態對照：Check → reviewing（設計確認中）、Design → in_progress（設計中）
 * 設計師／Planner 姓名 → 登入 email：透過 people.email（公司信箱）↔ users.notifyEmail（同一組公司信箱）
 *   比對出 users 的 doc id（真正登入用的 Gmail）；找不到對照的姓名（如部門代碼、非系統使用者）就只存姓名，不設 email。
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import * as XLSX from '@e965/xlsx'

const SA = process.env.SA
const XLSX_PATH = process.env.XLSX
const DRY = process.argv.includes('--dry-run')
if (!SA || !XLSX_PATH) { console.error('請設定 SA= 與 XLSX='); process.exit(1) }

const cred = JSON.parse(readFileSync(SA, 'utf8'))
const db = getFirestore(initializeApp({ credential: cert(cred) }))

// XLSX.readFile() 的 ESM 版本對非 ASCII 路徑(中文檔名)有讀取 bug，改用 buffer 讀取繞過；
// cellDates:true 讓交期欄位直接解析成 JS Date，避免手動換算 Excel 序列日期
const wb = XLSX.read(readFileSync(XLSX_PATH), { type: 'buffer', cellDates: true })
const sheet = wb.Sheets[wb.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
console.log('工作表:', wb.SheetNames[0], '| 資料列數:', rows.length - 1)

// ── 建立「姓名 → 登入 email」對照表 ──
const peopleSnap = await db.collection('people').get()
const usersSnap = await db.collection('users').get()
const people = peopleSnap.docs.map(d => d.data())
const users = usersSnap.docs.map(d => d.data())

const nameToEmail = new Map()
for (const p of people) {
  if (!p.email) continue
  const u = users.find(x => (x.notifyEmail || '').trim().toLowerCase() === p.email.trim().toLowerCase())
  if (u) nameToEmail.set(p.name.trim().toLowerCase(), u.email)
}
for (const u of users) {
  const key = (u.displayName || '').trim().toLowerCase()
  if (key && !nameToEmail.has(key)) nameToEmail.set(key, u.email)
}

function resolveName(name) {
  const n = (name || '').trim()
  if (!n) return { name: '', email: '' }
  const email = nameToEmail.get(n.toLowerCase()) || ''
  return { name: n, email }
}

function toDateStr(v) {
  if (!v) return ''
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  }
  return String(v).trim()
}

const STATUS_MAP = { 'Check': 'reviewing', 'Design': 'in_progress' }

let created = 0, skipped = 0, unmatchedDesigners = new Set(), unmatchedPlanners = new Set()

for (const row of rows.slice(1)) {
  const [statusRaw, designerRaw, plannerRaw, urgentRaw, regionRaw, nameRaw, docTypesRaw, dueDateRaw, proposalRaw, attachmentRaw, hoursRaw, noteRaw] = row
  const projectName = String(nameRaw || '').replace(/[\t\r\n]/g, ' ').trim()
  if (!projectName) { skipped++; continue }

  const status = STATUS_MAP[String(statusRaw || '').trim()] || 'assigned'
  const urgent = !!String(urgentRaw || '').trim()
  const region = String(regionRaw || '').trim()
  const docTypes = String(docTypesRaw || '').split(',').map(s => s.trim()).filter(Boolean)
  const dueDate = toDateStr(dueDateRaw)

  const descParts = []
  if (String(proposalRaw || '').trim()) descParts.push(`提案連結：${String(proposalRaw).trim()}`)
  if (String(attachmentRaw || '').trim()) descParts.push(`附件連結：${String(attachmentRaw).trim()}`)
  if (String(hoursRaw || '').trim()) descParts.push(`工時：${String(hoursRaw).trim()}`)
  if (String(noteRaw || '').trim()) descParts.push(`備註：${String(noteRaw).trim()}`)
  const description = descParts.join('\n')

  const designer = resolveName(designerRaw)
  const planner = resolveName(plannerRaw)
  if (designer.name && !designer.email) unmatchedDesigners.add(designer.name)
  if (planner.name && !planner.email) unmatchedPlanners.add(planner.name)

  const data = {
    urgent, region, projectName, docTypes, dueDate, description,
    attachments: [],
    submittedBy: planner.email || '',
    submittedByName: planner.name || '(未知)',
    status,
    assignedDesigners: designer.email ? [designer.email] : [],
    assignedDesignersNames: designer.name ? [designer.name] : [],
    reviewedBy: '(匯入)',
    reviewedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    ...(status === 'in_progress' ? { startedAt: FieldValue.serverTimestamp() } : {}),
    ...(status === 'reviewing' ? { startedAt: FieldValue.serverTimestamp(), reviewingAt: FieldValue.serverTimestamp() } : {}),
  }

  console.log(`${DRY ? '[dry-新增]' : '[新增]'} ${projectName} | ${status} | 設計師=${designer.name}(${designer.email || '無帳號'}) | Planner=${planner.name}(${planner.email || '無帳號'})`)
  if (!DRY) await db.collection('requests').add(data)
  created++
}

console.log(`\n完成：新增 ${created}、略過空白列 ${skipped}${DRY ? '（dry-run，未寫入）' : ''}`)
if (unmatchedDesigners.size) console.log('⚠️  查無帳號的設計師姓名：', [...unmatchedDesigners].join('、'))
if (unmatchedPlanners.size) console.log('⚠️  查無帳號的 Planner 姓名：', [...unmatchedPlanners].join('、'))
process.exit(0)
