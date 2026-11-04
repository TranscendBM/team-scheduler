#!/usr/bin/env node
// 本機反查：某個登入 email 在 AI 資料表裡的負責人代號是什麼。
// 代號是 HMAC(密鑰, email) 算出來的，沒有對照表存放在任何地方；要知道「D-xxxxxx 是誰」，
// 就是拿你已知的同仁 email 在本機算一次對照。結果只印在你的終端機，不寫檔、不上傳。
//
// 用法(密鑰請用環境變數傳入，不要寫在指令列參數或檔案裡)：
//   Windows PowerShell:  $env:AI_EXPORT_HMAC_KEY = '<密鑰>'; node scripts/ai-export-person-code.mjs a@gmail.com b@gmail.com
//   macOS/Linux:         AI_EXPORT_HMAC_KEY='<密鑰>' node scripts/ai-export-person-code.mjs a@gmail.com
// 第一個選項 --role=designer|planner|manager 可指定前綴(預設 designer)。
import { personCode } from '../functions/aiExport.js'

const key = process.env.AI_EXPORT_HMAC_KEY
if (!key) {
  console.error('✖ 請先設定環境變數 AI_EXPORT_HMAC_KEY')
  process.exit(1)
}
const argv = process.argv.slice(2)
const role = (argv.find((a) => a.startsWith('--role=')) || '--role=designer').split('=')[1]
const emails = argv.filter((a) => !a.startsWith('--'))
if (emails.length === 0) {
  console.error('✖ 請提供至少一個 email')
  process.exit(1)
}
for (const e of emails) console.log(`${e}\t${personCode(e, key, role)}`)
