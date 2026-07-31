#!/usr/bin/env node
// 對 `npm audit --json` 的結果做「有記錄、可到期」的白名單檢查，取代原本無條件 continue-on-error
// 的做法。設計原則是 fail closed：任何解析不出來的東西(懸空/循環參照、缺 GHSA、malformed
// JSON、malformed allowlist、npm audit 本身執行異常)一律當作失敗，絕不能因為「沒擷取到東西」
// 就放行。
//
// 白名單格式(scripts/audit-allowlist.json)：
//   { "entries": [{ ghsa, package, severity, reason, reviewedAt, reviewBy }] }
//   - ghsa 必須符合 GHSA-xxxx-xxxx-xxxx
//   - package/reason 必須是非空字串
//   - reviewedAt/reviewBy 必須是合法 ISO 日期(YYYY-MM-DD)，且 reviewedAt <= reviewBy
//   - reviewBy 是必填，不可省略(省略不會被當成永久放行，反而會讓白名單載入失敗)
//   - severity 不可以是 critical(critical 永遠不能被放行，寫在白名單也一樣沒用，而且
//     整份白名單只要出現一筆 critical 就視為 malformed，直接讓 audit 失敗)
//   - 不可以有重複的 ghsa/package 組合
//
// 純函式(loadAllowlist/validateAllowlistEntries/evaluateAudit/validateSpawnResult)刻意跟
// 「怎麼呼叫 npm audit」分開，方便不需要真的執行 npm audit 或讀檔，就能對各種 JSON 輸出/
// 白名單組合/spawnSync 結果寫單元測試，見 test/unit/check-npm-audit.test.js。
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ALLOWLIST_PATH = join(DIR, 'audit-allowlist.json')

const GHSA_RE = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i

// YYYY-MM-DD 格式檢查 + 用 Date 往返序列化排除「格式對但數值不合法」的日期(例如 2026-13-45
// 會被 Date 寬鬆解析成別的日期，往返後字串就對不上，藉此抓出來)。
function isValidIsoDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false
  const d = new Date(`${str}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return false
  return d.toISOString().slice(0, 10) === str
}

// 嚴格驗證白名單每一筆的 schema。回傳 { ok, errors } 而不是丟例外，方便單元測試直接檢查
// 「哪些欄位不合法」，loadAllowlist() 再把這個結果轉成丟例外(讓 main() 的 audit step 失敗)。
export function validateAllowlistEntries(entries) {
  const errors = []
  if (!Array.isArray(entries)) return { ok: false, errors: ['allowlist entries 不是陣列'] }

  const seen = new Set()
  entries.forEach((entry, i) => {
    const label = `entries[${i}]`
    if (!entry || typeof entry !== 'object') {
      errors.push(`${label} 不是物件`)
      return
    }
    if (typeof entry.ghsa !== 'string' || !GHSA_RE.test(entry.ghsa)) {
      errors.push(`${label}.ghsa 不符合 GHSA-xxxx-xxxx-xxxx 格式：${JSON.stringify(entry.ghsa)}`)
    }
    if (typeof entry.package !== 'string' || entry.package.trim() === '') {
      errors.push(`${label}.package 必須是非空字串`)
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      errors.push(`${label}.reason 必須是非空字串`)
    }
    const reviewedAtValid = isValidIsoDate(entry.reviewedAt)
    if (!reviewedAtValid) {
      errors.push(`${label}.reviewedAt 不是合法的 ISO 日期(YYYY-MM-DD)：${JSON.stringify(entry.reviewedAt)}`)
    }
    // reviewBy 是必填——缺少不能被當成「永久放行」，必須讓整份白名單驗證失敗
    const reviewByValid = isValidIsoDate(entry.reviewBy)
    if (!reviewByValid) {
      errors.push(`${label}.reviewBy 缺少或不是合法的 ISO 日期(reviewBy 為必填，不可省略當作永久放行)：${JSON.stringify(entry.reviewBy)}`)
    }
    if (reviewedAtValid && reviewByValid && entry.reviewedAt > entry.reviewBy) {
      errors.push(`${label}.reviewedAt (${entry.reviewedAt}) 晚於 reviewBy (${entry.reviewBy})`)
    }
    if (entry.severity === 'critical') {
      errors.push(`${label} severity 是 critical——allowlist 不得放行 critical，即使寫在白名單裡也一樣`)
    }
    if (typeof entry.ghsa === 'string' && typeof entry.package === 'string') {
      const key = `${entry.ghsa.toLowerCase()}::${entry.package}`
      if (seen.has(key)) errors.push(`${label} 重複的 ghsa/package 組合：${entry.ghsa} / ${entry.package}`)
      seen.add(key)
    }
  })

  return { ok: errors.length === 0, errors }
}

export function loadAllowlist(path = DEFAULT_ALLOWLIST_PATH) {
  const raw = readFileSync(path, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`白名單不是合法 JSON：${path} — ${err.message}`, { cause: err })
  }
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(`白名單格式錯誤(缺少 entries 陣列)：${path}`)
  }
  const validation = validateAllowlistEntries(parsed.entries)
  if (!validation.ok) {
    throw new Error(`白名單驗證失敗(${path})：\n${validation.errors.map((e) => `  - ${e}`).join('\n')}`)
  }
  return parsed.entries
}

// 遞迴解析單一套件的 via 鏈：
// - via 是字串 → 代表 vulnerabilities 裡另一個套件 key，必須繼續往下解析(多層 transitive)。
// - via 是物件且有可解析的 GHSA url → 這才是一個真正的 advisory。
// - via 是物件但沒有 url/解不出 GHSA → 視為錯誤(無法解析)，fail closed。
// - 參照到 vulnerabilities 裡不存在的套件 → 懸空參照，fail closed。
// - 參照形成循環(A -> B -> A) → 偵測到就停止遞迴並回報錯誤，不會無窮迴圈，也 fail closed。
// - via 是空陣列 → 這個套件沒有任何可解析的 advisory，fail closed(不能因為沒東西可查就放行)。
function resolveAdvisoriesForPackage(pkgName, vulnerabilities, visited) {
  if (visited.has(pkgName)) {
    return { advisories: [], errors: [`循環參照(cyclic via)：${[...visited, pkgName].join(' -> ')}`] }
  }
  const vuln = vulnerabilities[pkgName]
  if (!vuln || typeof vuln !== 'object') {
    return { advisories: [], errors: [`懸空參照(dangling via)：找不到套件 "${pkgName}" 的漏洞資料`] }
  }

  const nextVisited = new Set(visited)
  nextVisited.add(pkgName)

  const via = Array.isArray(vuln.via) ? vuln.via : []
  if (via.length === 0) {
    return { advisories: [], errors: [`套件 "${pkgName}" 的 via 是空陣列，沒有可解析的 advisory`] }
  }

  const advisories = []
  const errors = []
  for (const item of via) {
    if (typeof item === 'string') {
      const nested = resolveAdvisoriesForPackage(item, vulnerabilities, nextVisited)
      advisories.push(...nested.advisories)
      errors.push(...nested.errors)
    } else if (item && typeof item === 'object') {
      if (typeof item.url !== 'string' || item.url === '') {
        errors.push(`套件 "${pkgName}" 的 advisory 缺少 url，無法解析`)
        continue
      }
      const m = item.url.match(/\/advisories\/(GHSA-[a-zA-Z0-9-]+)/)
      if (!m) {
        errors.push(`套件 "${pkgName}" 的 advisory url 無法解析出 GHSA id：${item.url}`)
        continue
      }
      advisories.push({
        package: pkgName,
        severity: item.severity || vuln.severity,
        ghsaId: m[1],
        title: item.title || '(no title)',
        url: item.url,
      })
    } else {
      errors.push(`套件 "${pkgName}" 的 via 項目格式不明：${JSON.stringify(item)}`)
    }
  }
  return { advisories, errors }
}

function isAllowed(advisory, allowlistEntries, now) {
  if (advisory.severity === 'critical') return false // critical 一律不放行，無論白名單
  if (!advisory.ghsaId) return false // 解析不出 GHSA 的一律不算已放行
  return allowlistEntries.some((entry) => {
    if (entry.ghsa !== advisory.ghsaId) return false
    if (entry.package !== advisory.package) return false
    if (entry.severity !== advisory.severity) return false
    if (new Date(`${entry.reviewBy}T00:00:00Z`) < now) return false // 過期視為未列入白名單
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

  const vulnerabilities = data.vulnerabilities
  const rootPackages = Object.entries(vulnerabilities)
    .filter(([, v]) => v && (v.severity === 'high' || v.severity === 'critical'))
    .map(([name]) => name)

  const reasons = []
  const allAdvisories = []
  const seenAdvisoryKeys = new Set()

  for (const root of rootPackages) {
    const { advisories, errors } = resolveAdvisoriesForPackage(root, vulnerabilities, new Set())
    for (const err of errors) reasons.push(`[${root}] ${err}`)
    for (const adv of advisories) {
      const key = `${adv.package}::${adv.ghsaId}::${adv.severity}`
      if (seenAdvisoryKeys.has(key)) continue
      seenAdvisoryKeys.add(key)
      allAdvisories.push(adv)
    }
  }

  // 防禦性檢查：metadata 說有 high/critical，但我們完全沒找到任何 severity 為 high/critical
  // 的套件項目——這代表資料格式跟預期不符，不能因為「沒擷取到東西」就默默回傳成功。
  const metaHigh = data.metadata?.vulnerabilities?.high ?? 0
  const metaCritical = data.metadata?.vulnerabilities?.critical ?? 0
  if ((metaHigh > 0 || metaCritical > 0) && rootPackages.length === 0) {
    reasons.push(
      `metadata 回報 high=${metaHigh}/critical=${metaCritical}，但 vulnerabilities 裡找不到任何 `
      + 'severity 為 high/critical 的套件項目，資料可能不符預期格式',
    )
  }

  for (const advisory of allAdvisories) {
    if (advisory.severity !== 'high' && advisory.severity !== 'critical') continue
    if (!isAllowed(advisory, allowlistEntries, now)) {
      reasons.push(
        `未放行的 ${advisory.severity} 漏洞：${advisory.package} — ${advisory.title}`
        + (advisory.ghsaId ? ` (${advisory.ghsaId})` : ' (無法解析 GHSA id)')
        + ' — 不在白名單內，或白名單項目已過 reviewBy 到期日',
      )
    }
  }

  return { ok: reasons.length === 0, reasons, advisories: allAdvisories }
}

// 驗證 spawnSync('npm', ['audit', '--json'], ...) 的回傳結果本身是否可信：
// - result.error：指令根本沒能執行(例如找不到 npm)
// - result.signal：被訊號中止(例如逾時被 kill)
// - result.status 是 null/undefined：沒有正常結束
// - npm audit 只有 exit code 0(無漏洞)或 1(有漏洞，交給 parser 判斷)是正常結果，
//   其他任何 exit code(例如 2，代表 npm audit 自己出錯，不是「有漏洞」)一律視為失敗。
// stdout 是空字串或缺失時，即使 stderr 有內容也絕對不能拿 stderr 當 JSON 解析。
export function validateSpawnResult(result) {
  if (!result) return { ok: false, reason: 'spawnSync 沒有回傳任何結果' }
  if (result.error) return { ok: false, reason: `執行 npm audit 失敗：${result.error.message}` }
  if (result.signal) return { ok: false, reason: `npm audit 被訊號中止：${result.signal}` }
  if (result.status === null || result.status === undefined) {
    return { ok: false, reason: 'npm audit 沒有正常結束(exit code 是 null/undefined)' }
  }
  if (result.status !== 0 && result.status !== 1) {
    return { ok: false, reason: `npm audit 回傳非預期的 exit code：${result.status}(只接受 0 或 1)` }
  }
  return { ok: true, stdout: result.stdout }
}

function main() {
  const cwd = process.argv[2] ? resolve(process.argv[2]) : process.cwd()
  const allowlistPath = process.argv[3] ? resolve(process.argv[3]) : DEFAULT_ALLOWLIST_PATH

  let allowlist
  try {
    allowlist = loadAllowlist(allowlistPath)
  } catch (err) {
    console.error(`讀取/驗證白名單失敗：${err.message}`)
    process.exit(1)
  }

  const result = spawnSync('npm', ['audit', '--json'], {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 20 * 1024 * 1024,
  })

  const spawnCheck = validateSpawnResult(result)
  if (!spawnCheck.ok) {
    console.error(`npm audit 執行異常：${spawnCheck.reason}`)
    process.exit(1)
  }

  const evaluation = evaluateAudit(spawnCheck.stdout, allowlist, {})

  console.log(`npm audit allowlist 檢查（${cwd}）`)
  if (evaluation.advisories.length === 0) {
    console.log('沒有解析到 high/critical 等級的 advisory。')
  } else {
    for (const a of evaluation.advisories) {
      const allowed = isAllowed(a, allowlist, new Date())
      console.log(`  [${allowed ? '放行' : '未放行'}] ${a.severity} ${a.package} ${a.ghsaId || '(no ghsa id)'} — ${a.title}`)
    }
  }

  if (!evaluation.ok) {
    console.error('\n檢查失敗：')
    for (const reason of evaluation.reasons) console.error(`  - ${reason}`)
    process.exit(1)
  }

  console.log('\n通過：所有 high/critical advisory 都已解析、都在白名單內且未過期，沒有 critical、沒有無法解析的參照。')
  process.exit(0)
}

// 用 pathToFileURL 而不是手動拼 `file://${path}` —— Windows 路徑含反斜線、且絕對路徑的
// file: URL 需要三個斜線，手動拼字串在 Windows 上會比對失敗，導致直接執行這個檔案時
// main() 沒被呼叫到。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
