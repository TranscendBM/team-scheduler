#!/usr/bin/env node
/**
 * 匯入「TS Attend {YEAR}」秀展資料（Excel）到 projects（type=tradeshow）。
 *
 * USD 金額不採用檔案裡既有的欄位，改用「office 對照的當地貨幣」＋歷史匯率（frankfurter.dev）
 * 重新計算：過去日期用當天的歷史匯率，未來場次（ECB 尚未公告）改用目前最新一筆匯率估算。
 * TWD（ECB 未追蹤）只補 currency 欄位，USD 需人工填。
 *
 * 注意：不同年度分頁的欄位版型不一致（已手動核對過 2025／2027 兩種版型），
 * 依表頭是否有「貨幣」欄自動判斷版型；若日後又出現新版型，請先核對欄位再匯入。
 *
 * 用法：SA=/path/sa.json XLSX=/path/2025.xlsx YEAR=2025 node scripts/import_tradeshow_year.mjs [--dry-run]
 *
 * 比對規則：依「專案名稱」（trim 後）比對系統既有秀展。
 *   - 有同名 → 更新規格/預算欄位 + 基本資訊，保留既有 assignments（已指派人員）與 artworkDone（出稿狀態）。
 *   - 無同名 → 新增一筆完整資料。
 */
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as XLSX from '@e965/xlsx'
import { OFFICE_CURRENCY } from '../src/utils/officeCurrency.js'

const SA = process.env.SA
const XLSX_PATH = process.env.XLSX
const YEAR = parseInt(process.env.YEAR || '')
const DRY = process.argv.includes('--dry-run')
if (!SA || !XLSX_PATH || !YEAR) { console.error('請設定 SA=、XLSX=、YEAR='); process.exit(1) }

function parseDateRange(dateStr, year) {
  const cleaned = String(dateStr || '').replace(/[\r\n]/g, '').trim()
  const m = cleaned.match(/(\d{1,2})\/(\d{1,2})\s*[~～-]\s*(\d{1,2})\/(\d{1,2})/)
  if (!m) return { startDate: '', endDate: '' }
  const [, sm, sd, em, ed] = m.map(Number)
  const endYear = em < sm ? year + 1 : year
  const pad = (n) => String(n).padStart(2, '0')
  return { startDate: `${year}-${pad(sm)}-${pad(sd)}`, endDate: `${endYear}-${pad(em)}-${pad(ed)}` }
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined }
function setIfDefined(obj, key, val) { if (val !== undefined && val !== '') obj[key] = val }

const cred = JSON.parse(readFileSync(SA, 'utf8'))
const db = getFirestore(initializeApp({ credential: cert(cred) }))

// XLSX.readFile() 的 ESM 版本對非 ASCII 路徑有讀取 bug，改用 buffer 讀取繞過
const wb = XLSX.read(readFileSync(XLSX_PATH), { type: 'buffer' })
const sheet = wb.Sheets[wb.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
const header = rows[0].map(h => String(h || '').replace(/\s+/g, '').trim())
console.log('工作表:', wb.SheetNames[0], '| 資料列數:', rows.length - 1)

// 2025 版型多了「貨幣」「匯率」兩欄，欄位位置整個往後推；2027 版型沒有這兩欄
const hasCurrencyCol = header.includes('貨幣')
const COLS = hasCurrencyCol
  ? { status: 1, date: 2, office: 3, location: 4, showType: 5, boothFormat: 6, boothDimensions: 7, boothSqm: 8, boothCount: 9, currency: 10, rentLocal: 12, decorLocal: 15, prLocal: 17, visitors: 19, exhibitors: 20 }
  : { status: 1, date: 2, office: 3, location: 4, showType: 5, boothFormat: 6, boothDimensions: 7, boothSqm: 8, boothCount: 9, currency: null, rentLocal: 10, decorLocal: 12, prLocal: 14, visitors: 16, exhibitors: 17 }
console.log('欄位版型:', hasCurrencyCol ? '含貨幣/匯率欄（2025 式）' : '無貨幣欄，依 office 對照（2027 式）')

const TODAY = new Date().toISOString().slice(0, 10)
const rateCache = new Map()
async function historicalRate(date, currency) {
  if (currency === 'USD') return 1
  const effectiveDate = date > TODAY ? 'latest' : date
  const key = `${effectiveDate}:${currency}`
  if (rateCache.has(key)) return rateCache.get(key)
  const res = await fetch(`https://api.frankfurter.dev/v1/${effectiveDate}?from=USD&to=${currency}`)
  if (!res.ok) throw new Error(`frankfurter.dev 回應失敗 ${effectiveDate} ${currency}:${res.status}`)
  const data = await res.json()
  const rate = data.rates?.[currency]
  rateCache.set(key, rate)
  return rate
}

const existingSnap = await db.collection('projects').where('type', '==', 'tradeshow').get()
// key 含年度：許多年年舉辦的秀展名稱不帶年份（如 SIDO、FMS），只比對名稱會誤把不同年度的既有資料當同一筆覆蓋掉
const existingByKey = {}
existingSnap.docs.forEach(d => {
  const p = d.data()
  existingByKey[`${String(p.name || '').trim()}::${p.year}`] = { id: d.id, ...p }
})

let created = 0, updated = 0, skipped = 0, twdNoConvert = 0, noCurrency = 0, fxFailed = 0

for (const row of rows.slice(1)) {
  const name = String(row[0] || '').replace(/[\r\n]/g, '').trim()
  if (!name) { skipped++; continue }
  const { startDate, endDate } = parseDateRange(row[COLS.date], YEAR)
  const office = String(row[COLS.office] || '').trim()

  const specFields = {}
  setIfDefined(specFields, 'boothFormat', String(row[COLS.boothFormat] || '').trim())
  setIfDefined(specFields, 'boothDimensions', String(row[COLS.boothDimensions] || '').replace(/[\r\n]/g, ' ').trim())
  setIfDefined(specFields, 'boothSqm', num(row[COLS.boothSqm]))
  const boothCountNum = num(row[COLS.boothCount])

  const rentLocal = num(row[COLS.rentLocal])
  const decorLocal = num(row[COLS.decorLocal])
  const prLocal = num(row[COLS.prLocal])
  setIfDefined(specFields, 'rentLocal', rentLocal)
  setIfDefined(specFields, 'decorLocal', decorLocal)
  setIfDefined(specFields, 'prLocal', prLocal)
  setIfDefined(specFields, 'visitors', num(row[COLS.visitors]))
  setIfDefined(specFields, 'exhibitors', num(row[COLS.exhibitors]))

  // 貨幣別：優先用 office 對照表；查無對照才退回檔案本身的貨幣欄（若該版型有）
  const currency = OFFICE_CURRENCY[office.toUpperCase()] || (COLS.currency != null ? String(row[COLS.currency] || '').trim() : '')
  if (currency) specFields.currency = currency

  if (!currency) {
    noCurrency++
    console.log(`⚠️  ${name}：office「${office}」查無貨幣對照，USD 需人工填`)
  } else if (currency === 'TWD') {
    twdNoConvert++
    console.log(`💰 ${name}（${office}）：只補 currency=TWD，USD 需人工填（ECB 無 TWD 歷史匯率）`)
  } else if (!startDate) {
    console.log(`⏭  ${name}：日期解析失敗，無法查匯率，只補 currency=${currency}`)
  } else {
    try {
      const rate = await historicalRate(startDate, currency)
      if (rate) {
        if (rentLocal > 0) specFields.rentUSD = Math.round((rentLocal / rate) * 100) / 100
        if (decorLocal > 0) specFields.decorUSD = Math.round((decorLocal / rate) * 100) / 100
        if (prLocal > 0) specFields.prUSD = Math.round((prLocal / rate) * 100) / 100
        const dateLabel = startDate > TODAY ? '未來場次估算匯率' : `${startDate}當時匯率`
        console.log(`💱 ${name}（${office}/${currency}，${dateLabel} 1USD≈${rate}${currency}）`)
      }
    } catch (e) {
      fxFailed++
      console.error(`❌ ${name} 查匯率失敗：${e.message}`)
    }
  }

  const basicFields = {
    startDate, endDate,
    location: String(row[COLS.location] || '').replace(/[\r\n]/g, ' ').trim(),
    showType: String(row[COLS.showType] || '').trim(),
    office,
    status: String(row[COLS.status] || '').replace(/[\r\n]/g, ' ').trim(),
  }
  if (boothCountNum !== undefined) basicFields.boothSize = boothCountNum

  const existing = existingByKey[`${name}::${YEAR}`]
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

console.log(`\n完成：新增 ${created}、更新 ${updated}、略過空白列 ${skipped}、查無貨幣對照 ${noCurrency}、TWD 未換算 ${twdNoConvert}、查匯率失敗 ${fxFailed}${DRY ? '（dry-run，未寫入）' : ''}`)
process.exit(0)
