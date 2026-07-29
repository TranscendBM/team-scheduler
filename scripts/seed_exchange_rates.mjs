#!/usr/bin/env node
/**
 * 一次性補抓匯率，讓 settings/exchangeRates 立即有資料，不用等明天 02:00 排程第一次執行。
 * 用法：SA=/path/sa.json node scripts/seed_exchange_rates.mjs
 */
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const SA = process.env.SA
if (!SA) { console.error('請設定 SA=/path/sa.json'); process.exit(1) }

initializeApp({ credential: cert(SA) })
const db = getFirestore()

const res = await fetch('https://api.frankfurter.dev/v1/latest?from=USD')
if (!res.ok) throw new Error(`frankfurter.dev 回應失敗:${res.status}`)
const data = await res.json()

await db.collection('settings').doc('exchangeRates').set({
  base: 'USD',
  rates: data.rates,
  date: data.date,
  updatedAt: new Date().toISOString(),
})

console.log('匯率已寫入 settings/exchangeRates', { date: data.date, rates: data.rates })
