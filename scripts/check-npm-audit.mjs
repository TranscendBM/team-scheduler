#!/usr/bin/env node
// 對 `npm audit --json` 的結果做「有記錄、可到期」的白名單檢查，取代原本無條件 continue-on-error
// 的做法。任何 critical 一律失敗(無論有沒有列在白名單都不例外)；任何 high 只有在白名單裡有
// 對應的 GHSA id + 套件名稱、且還沒過 reviewBy 到期日，才會放行；moderate/low/info 不擋。
//
// 白名單格式(scripts/audit-allowlist.json)：
//   { "entries": [{ ghsaId, package, severity, reason, reviewedAt, reviewBy }] }
//
// 純函式(loadAllowlist/evaluateAudit)刻意跟「怎麼呼叫 npm audit」分開，方便不需要真的執行
// npm audit 就能對各種 audit JSON 輸出/白名單組合寫單元測試，見 test/unit/check-npm-audit.test.js。
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ALLOWLIST_PATH = join(DIR, 'audit-allowlist.json')

export function loadAllowlist(path = DEFAULT_ALLOWLIST_PATH) {
  const raw = readFileSync(path, 'utf8')
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed?.entries)) throw new Error(`白名單格式錯誤(缺少 entries 陣列): ${path}`)
  return parsed.entries
}

// 從 npm audit --json 的單一 vulnerability 條目裡，抽出真正的 advisory(GHSA)——`via` 陣列
// 裡有時是字串(單純指向另一個造成間接依賴的套件名稱，不是 advisory 本身)，有時是物件
// (真正的 advisory，含 url/severity)。只有物件形式才算一個要檢查的 advisory。
function extractAdvisories(vulnerabilities) {
  const advisories = []
  for (const [pkgName, vuln] of Object.entries(vulnerabilities || {})) {
    for (const via of vuln.via || []) {
      if (typeof via !== 'object' || !via.url) continue
      const m = via.url.match(/\/advisories\/(GHSA-[a-z0-9-]+)/i)
      advisories.push({
        package: pkgName,
        severity: via.severity || vuln.severity,
        ghsaId: m ? m[1] : null,
        title: via.title || '(no title)',
        url: via.url,
      })
    }
  }
  return advisories
}

function isAllowed(advisory, allowlistEntries, now) {
  if (advisory.severity === 'critical') return false // critical 一律不放行，無論白名單
  return allowlistEntries.some((entry) => {
    if (entry.ghsaId !== advisory.ghsaId) return false
    if (entry.package !== advisory.package) return false
    if (entry.severity !== advisory.severity) return false
    if (entry.reviewBy && new Date(entry.reviewBy) < now) return false // 過期視為未列入白名單
    return true
  })
}

// 純函式：給定 npm audit --json 的原始字串輸出(可能是 null/空字串，代表指令根本沒跑出東西)
// 跟白名單清單，回傳 { ok, reasons, advisories }。不會呼叫 npm、不會讀檔、不會印東西 ——
// 方便直接餵各種捏造的 JSON 字串做單元測試。
export function evaluateAudit(rawStdout, allowlistEntries, { now = new Date() } = {}) {
  if (rawStdout == null || String(rawStdout).trim() === '') {
    return { ok: false, reasons: ['npm audit 沒有任何輸出(指令可能執行失敗，或被中斷)'], advisories: [] }
  }
  let data
  try {
    data = JSON.parse(rawStdout)
  } catch (err) {
    return { ok: false, reasons: [`npm audit 輸出不是合法的 JSON：${err.message}`], advisories: [] }
  }
  if (!data || typeof data !== 'object' || !data.vulnerabilities || typeof data.vulnerabilities !== 'object') {
    return { ok: false, reasons: ['npm audit JSON 缺少預期的 vulnerabilities 欄位'], advisories: [] }
  }

  const advisories = extractAdvisories(data.vulnerabilities)
  const reasons = []

  const criticalCount = data.metadata?.vulnerabilities?.critical ?? 0
  if (criticalCount > 0) {
    reasons.push(`發現 ${criticalCount} 個 critical 漏洞，一律不放行(不受白名單影響)`)
  }

  for (const advisory of advisories) {
    if (advisory.severity !== 'high' && advisory.severity !== 'critical') continue
    if (!isAllowed(advisory, allowlistEntries, now)) {
      reasons.push(
        `未放行的 ${advisory.severity} 漏洞：${advisory.package} — ${advisory.title}`
        + (advisory.ghsaId ? ` (${advisory.ghsaId})` : ' (無法解析 GHSA id)')
        + ' — 不在白名單內，或白名單項目已過 reviewBy 到期日',
      )
    }
  }

  return { ok: reasons.length === 0, reasons, advisories }
}

function main() {
  const cwd = process.argv[2] ? resolve(process.argv[2]) : process.cwd()
  const allowlistPath = process.argv[3] ? resolve(process.argv[3]) : DEFAULT_ALLOWLIST_PATH

  let allowlist
  try {
    allowlist = loadAllowlist(allowlistPath)
  } catch (err) {
    console.error(`讀取白名單失敗：${err.message}`)
    process.exit(1)
  }

  const result = spawnSync('npm', ['audit', '--json'], {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 20 * 1024 * 1024,
  })

  const rawStdout = result.error ? null : result.stdout
  const evaluation = evaluateAudit(rawStdout, allowlist, {})

  console.log(`npm audit allowlist 檢查（${cwd}）`)
  if (evaluation.advisories.length === 0) {
    console.log('沒有 high/critical 等級的 advisory。')
  } else {
    for (const a of evaluation.advisories) {
      if (a.severity !== 'high' && a.severity !== 'critical') continue
      const allowed = isAllowed(a, allowlist, new Date())
      console.log(`  [${allowed ? '放行' : '未放行'}] ${a.severity} ${a.package} ${a.ghsaId || '(no ghsa id)'} — ${a.title}`)
    }
  }

  if (!evaluation.ok) {
    console.error('\n檢查失敗：')
    for (const reason of evaluation.reasons) console.error(`  - ${reason}`)
    process.exit(1)
  }

  console.log('\n通過：所有 high/critical advisory 都在白名單內且未過期，沒有 critical。')
  process.exit(0)
}

// 用 pathToFileURL 而不是手動拼 `file://${path}` —— Windows 路徑含反斜線、且絕對路徑的
// file: URL 需要三個斜線，手動拼字串在 Windows 上會比對失敗，導致直接執行這個檔案時
// main() 沒被呼叫到。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
