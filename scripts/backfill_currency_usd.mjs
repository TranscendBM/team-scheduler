#!/usr/bin/env node
/**
 * 依分公司對照表補上 currency 欄位，並用「秀展當時（startDate）」的歷史匯率
 * 重新計算 rentUSD / decorUSD / prUSD（用 rentLocal / decorLocal / prLocal 換算，全部覆蓋現有 USD 值）。
 *
 * 資料來源：frankfurter.dev（ECB 歷史匯率，免費不需金鑰）。ECB 未追蹤 TWD，
 * 所以 TW（新台幣）只補 currency 欄位，USD 金額維持原樣，不強行換算。
 *
 * 用法：SA=/path/sa.json node scripts/backfill_currency_usd.mjs [--dry-run]
 */
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { OFFICE_CURRENCY } from '../src/utils/officeCurrency.js'

const SA = process.env.SA
const DRY = process.argv.includes('--dry-run')
if (!SA) { console.error('請設定 SA=/path/sa.json'); process.exit(1) }

initializeApp({ credential: cert(SA) })
const db = getFirestore()

const TODAY = new Date().toISOString().slice(0, 10)

const rateCache = new Map() // `${date}:${currency}` -> rate（1 USD = rate 該貨幣）
async function historicalRate(date, currency) {
  if (currency === 'USD') return 1 // 美金換美金，免查
  // ECB 尚未公告未來日期的匯率，未來場次改用最新一筆已公告匯率（latest）估算
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

const snap = await db.collection('projects').where('type', '==', 'tradeshow').get()
const projects = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }))

let updated = 0, skippedNoOffice = 0, skippedTWD = 0, skippedNoData = 0, failed = 0

for (const p of projects) {
  const currency = OFFICE_CURRENCY[p.office]
  if (!currency) { skippedNoOffice++; console.log(`⏭  跳過（office 未對照）：${p.name}（${p.office || '無 office'}）`); continue }

  const update = { currency }
  const NUMBER_PAIRS = [['rentLocal', 'rentUSD'], ['decorLocal', 'decorUSD'], ['prLocal', 'prUSD']]

  if (currency === 'TWD') {
    // ECB 無 TWD 歷史匯率，只補貨幣別標示，USD 金額維持原樣（需人工確認）
    skippedTWD++
    console.log(`💰 ${p.name}（TW）：只補 currency=TWD，USD 金額不動（ECB 無 TWD 歷史匯率）`)
  } else if (!p.startDate) {
    skippedNoData++
    console.log(`⏭  跳過（無 startDate 無法查當時匯率）：${p.name}`)
    continue
  } else {
    try {
      const rate = await historicalRate(p.startDate, currency)
      if (!rate) throw new Error('查無匯率')
      let anyConverted = false
      for (const [localKey, usdKey] of NUMBER_PAIRS) {
        const local = p[localKey]
        if (local === undefined || local === null || local === '' || local <= 0) continue
        update[usdKey] = Math.round((local / rate) * 100) / 100
        anyConverted = true
      }
      if (anyConverted) {
        const dateLabel = p.startDate > TODAY ? `未來場次，估算用最新匯率` : `${p.startDate} 當時匯率`
        console.log(`💱 ${p.name}（${p.office} / ${currency}，${dateLabel} 1USD≈${rate}${currency}）：${NUMBER_PAIRS.map(([, u]) => update[u] !== undefined ? `${u}=${update[u]}` : null).filter(Boolean).join('、')}`)
      } else {
        console.log(`⏭  ${p.name}：有 currency 對照但沒有當地金額可換算，只補 currency=${currency}`)
      }
    } catch (e) {
      failed++
      console.error(`❌ ${p.name} 查匯率失敗：${e.message}`)
      continue
    }
  }

  updated++
  if (!DRY) {
    await p.ref.update({ ...update, updatedAt: new Date().toISOString() })
  }
}

console.log(`\n${DRY ? '（dry-run，未寫入）' : '完成'}：更新 ${updated} 筆，跳過(office 無對照) ${skippedNoOffice} 筆，TWD 僅補貨幣別 ${skippedTWD} 筆，無日期跳過 ${skippedNoData} 筆，查匯率失敗 ${failed} 筆`)
