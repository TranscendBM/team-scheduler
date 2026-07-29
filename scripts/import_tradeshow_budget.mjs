#!/usr/bin/env node
/**
 * 匯入「TS Attend」年度秀展預算追蹤表（Excel）到 projects（type=tradeshow）。
 * 用法：SA=/path/sa.json XLSX=/path/file.xlsx YEAR=2026 node scripts/import_tradeshow_budget.mjs [--dry-run]
 *
 * 比對規則：依「專案名稱」（trim 後）比對系統既有秀展。
 *   - 有同名 → 更新規格/預算欄位 + 基本資訊（日期/地點/展會類型/office/攤位數量），
 *     但保留既有的 assignments（已指派人員）與 artworkDone（出稿狀態），不覆蓋。
 *   - 無同名 → 新增一筆完整資料。
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as XLSX from '@e965/xlsx'

const SA = process.env.SA
const XLSX_PATH = process.env.XLSX
const YEAR = parseInt(process.env.YEAR || '2026')
const DRY = process.argv.includes('--dry-run')
if (!SA || !XLSX_PATH) { console.error('請設定 SA= 與 XLSX='); process.exit(1) }

function parseDateRange(dateStr, year) {
  const cleaned = String(dateStr || '').replace(/[\r\n]/g, '').trim()
  const m = cleaned.match(/(\d{1,2})\/(\d{1,2})\s*[~～-]\s*(\d{1,2})\/(\d{1,2})/)
  if (!m) return { startDate: '', endDate: '' }
  const [, sm, sd, em, ed] = m.map(Number)
  const endYear = em < sm ? year + 1 : year
  const pad = (n) => String(n).padStart(2, '0')
  return {
    startDate: `${year}-${pad(sm)}-${pad(sd)}`,
    endDate: `${endYear}-${pad(em)}-${pad(ed)}`,
  }
}

const num = (v) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : undefined
}
function setIfDefined(obj, key, val) { if (val !== undefined && val !== '') obj[key] = val }

const cred = JSON.parse(readFileSync(SA, 'utf8'))
const db = getFirestore(initializeApp({ credential: cert(cred) }))

// XLSX.readFile() 的 ESM 版本對非 ASCII 路徑(中文檔名)有讀取 bug，改用 buffer 讀取繞過
const wb = XLSX.read(readFileSync(XLSX_PATH), { type: 'buffer' })
const sheet = wb.Sheets[wb.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
console.log('工作表:', wb.SheetNames[0], '| 資料列數:', rows.length - 1)

// 既有秀展（依 trim 後名稱比對）
const existingSnap = await db.collection('projects').where('type', '==', 'tradeshow').get()
const existingByName = {}
existingSnap.docs.forEach(d => { existingByName[String(d.data().name || '').trim()] = { id: d.id, ...d.data() } })

let created = 0, updated = 0, skipped = 0

for (const row of rows.slice(1)) {
  const [rawName, status, dateStr, office, location, showType, boothFormat, boothDimensions, boothSqm,
    boothCount, rentLocal, rentUSD, decorLocal, decorUSD, prLocal, prUSD, visitors, exhibitors] = row
  const name = String(rawName || '').replace(/[\r\n]/g, '').trim()
  if (!name) { skipped++; continue }
  const { startDate, endDate } = parseDateRange(dateStr, YEAR)

  const specFields = {}
  setIfDefined(specFields, 'boothFormat', String(boothFormat || '').trim())
  setIfDefined(specFields, 'boothDimensions', String(boothDimensions || '').replace(/[\r\n]/g, ' ').trim())
  setIfDefined(specFields, 'boothSqm', num(boothSqm))
  setIfDefined(specFields, 'rentLocal', num(rentLocal))
  setIfDefined(specFields, 'rentUSD', num(rentUSD))
  setIfDefined(specFields, 'decorLocal', num(decorLocal))
  setIfDefined(specFields, 'decorUSD', num(decorUSD))
  setIfDefined(specFields, 'prLocal', num(prLocal))
  setIfDefined(specFields, 'prUSD', num(prUSD))
  setIfDefined(specFields, 'visitors', num(visitors))
  setIfDefined(specFields, 'exhibitors', num(exhibitors))

  const basicFields = {
    startDate, endDate,
    location: String(location || '').replace(/[\r\n]/g, ' ').trim(),
    showType: String(showType || '').trim(),
    office: String(office || '').trim(),
    status: String(status || '').trim(),
  }
  const boothCountNum = num(boothCount)
  if (boothCountNum !== undefined) basicFields.boothSize = boothCountNum

  const existing = existingByName[name]
  if (existing) {
    console.log(`${DRY ? '[dry-更新]' : '[更新]'} ${name}`)
    if (!DRY) {
      await db.collection('projects').doc(existing.id).update({
        ...basicFields, ...specFields, updatedAt: new Date().toISOString(),
      })
    }
    updated++
  } else {
    console.log(`${DRY ? '[dry-新增]' : '[新增]'} ${name}`)
    if (!DRY) {
      await db.collection('projects').add({
        name, type: 'tradeshow', subtype: '', year: YEAR, assignments: [], artworkDone: false,
        ...basicFields, ...specFields,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      })
    }
    created++
  }
}

console.log(`\n完成：新增 ${created}、更新 ${updated}、略過空白列 ${skipped}${DRY ? '（dry-run，未寫入）' : ''}`)
process.exit(0)
