#!/usr/bin/env node
// 跨平台(Windows / macOS / GitHub Actions Ubuntu)的 rules test 執行腳本。
// 取代原本內嵌在 package.json 裡、依賴 POSIX shell 語法($?、test -eq 等)的版本——
// 那個版本在 Windows(cmd.exe 不支援單引號分組、也沒有 $?/test 這些語法)上完全跑不動。
//
// 執行順序:
// 1) vitest run test/rules --no-file-parallelism (Firestore + Storage 規則測試)
// 2) 不論 1) 成功與否，都接著跑 renameUserLogin + resolveActivePlannerCcEmails 這兩組
//    Firestore Emulator 整合測試(node:test)——確保前段失敗不會讓後段被整個跳過不執行。
// 3) 只要任一組失敗，最終以非 0 exit code 結束；兩邊的 stdout/stderr 都直接繼承轉送到目前終端機。
//
// 本身不啟動/管理 emulator——由 package.json 的 test:rules 透過
// `firebase emulators:exec --project demo-team-scheduler-rules` 包住整個腳本執行。
// 兩段測試都直接用絕對路徑呼叫 `node` 本身(process.execPath)執行實際的 .mjs 入口檔，
// 不透過 shell、不倚賴 node_modules/.bin 底下的 shim(Windows 是 .cmd/.ps1，POSIX 是 shell script)，
// 避免三個平台對「怎麼解析/執行 shim」規則不同而炸掉。
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function run(label, args) {
  console.log(`\n▶ ${label}\n  ${process.execPath} ${args.join(' ')}\n`)
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' })
  if (result.error) {
    console.error(`✖ ${label} 無法啟動:`, result.error.message)
    return 1
  }
  if (result.signal) {
    console.error(`✖ ${label} 被訊號中止:`, result.signal)
    return 1
  }
  return result.status ?? 1
}

const vitestBin = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')

const rulesStatus = run(
  'Firestore + Storage rules tests',
  [vitestBin, 'run', 'test/rules', '--no-file-parallelism']
)

const integrationStatus = run(
  'renameUserLogin + resolveActivePlannerCcEmails 整合測試',
  [
    '--test',
    'functions/test/renameUserLogin.test.js',
    'functions/test/resolveActivePlannerCcEmails.test.js',
  ]
)

console.log(
  `\n=== rules tests 執行結果彙整 ===\n` +
  `rules tests (firestore + storage)       exit code: ${rulesStatus}\n` +
  `integration tests (rename + ccPlanners) exit code: ${integrationStatus}\n`
)

process.exit(rulesStatus === 0 && integrationStatus === 0 ? 0 : 1)
