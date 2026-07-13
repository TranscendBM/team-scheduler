#!/usr/bin/env node
/**
 * 用 service account 直接透過 Firebase Rules REST API 部署 firestore.rules，
 * 繞過 firebase-tools 需要的 serviceusage 權限。
 *
 * 用法：SA=/path/sa.json node scripts/deploy_rules.mjs
 */
import { readFileSync } from 'node:fs'
import { GoogleAuth } from 'google-auth-library'

const SA = process.env.SA
if (!SA) { console.error('❌ 請設定 SA=service account json 路徑'); process.exit(1) }

const cred = JSON.parse(readFileSync(SA, 'utf8'))
const project = cred.project_id
const rulesSource = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')

const auth = new GoogleAuth({
  credentials: cred,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
})
const client = await auth.getClient()
const { token } = await client.getAccessToken()
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const BASE = 'https://firebaserules.googleapis.com/v1'

// 1) 建立 ruleset
let r = await fetch(`${BASE}/projects/${project}/rulesets`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: rulesSource }] } }),
})
let body = await r.json()
if (!r.ok) { console.error('❌ 建立 ruleset 失敗:', JSON.stringify(body)); process.exit(1) }
const rulesetName = body.name
console.log('✅ ruleset 建立:', rulesetName)

// 2) 更新 release cloud.firestore 指向新 ruleset（release 已存在 → PATCH）
const releaseName = `projects/${project}/releases/cloud.firestore`
r = await fetch(`${BASE}/${releaseName}`, {
  method: 'PATCH', headers: H,
  body: JSON.stringify({ release: { name: releaseName, rulesetName } }),
})
body = await r.json()
if (!r.ok) { console.error('❌ 更新 release 失敗:', JSON.stringify(body)); process.exit(1) }
console.log('✅ firestore 規則已上線:', releaseName)
