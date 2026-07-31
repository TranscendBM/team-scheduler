#!/usr/bin/env node
// 對 `npm audit --json` 的結果做「有記錄、可到期」的白名單檢查，取代原本無條件 continue-on-error
// 的做法。設計原則是 fail closed：任何解析不出來的東西(懸空/循環參照、缺 GHSA、malformed
// JSON、malformed allowlist、npm audit 本身執行異常、severity 無法辨識、metadata 與實際
// vulnerabilities 對不上)一律當作失敗，絕不能因為「沒擷取到東西」或「被 leaf 節點的較低
// severity 蓋掉」就放行。
//
// 白名單格式(scripts/audit-allowlist.json)：
//   { "entries": [{ ghsa, package, severity, reason, reviewedAt, reviewBy }] }
//   - ghsa 必須符合 GHSA-xxxx-xxxx-xxxx
//   - package/reason 必須是非空字串
//   - severity 必須「恰好」是字串 'high'——除此之外任何值(缺少、undefined、null、
//     'moderate'、'critical'、'banana'、數字...)都視為 malformed，讓整份白名單驗證失敗。
//     critical 永遠不能被放行，這裡不是「檢查是不是 critical」，而是「只接受 high 這一種值」，
//     兩者看似等價但後者才能同時擋下所有其他不合法的值。
//   - reviewedAt/reviewBy 必須是合法 ISO 日期(YYYY-MM-DD)，且 reviewedAt <= reviewBy
//   - reviewBy 是必填，不可省略(省略不會被當成永久放行，反而會讓白名單載入失敗)
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

// severity 的嚴重程度排序，用來在遞迴解析 via 鏈時取「沿路遇到的最高值」，
// 不可以讓 leaf 節點的較低 severity 蓋掉 root 的較高 severity。
const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 }

function isKnownSeverity(s) {
  return typeof s === 'string' && Object.hasOwn(SEVERITY_RANK, s)
}

// 兩個「已知合法」的 severity 取較高值；呼叫端必須先各自驗證過是已知值才呼叫這個函式。
function higherSeverity(a, b) {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b
}

function isNonNegativeInteger(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

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
    // severity 必須「恰好」是 'high'——不是只檢查「是不是 critical」，這樣才能同時擋下
    // missing/undefined/null/'moderate'/數字/'banana' 等任何非 'high' 的值。
    if (entry.severity !== 'high') {
      errors.push(`${label}.severity 必須恰好是 'high'(allowlist 只能放行 high，其餘一律視為 malformed)：${JSON.stringify(entry.severity)}`)
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

// 遞迴解析單一套件的 via 鏈，沿路傳遞「目前為止遇到的最高 severity」(inheritedSeverity)：
// - via 是字串 → 代表 vulnerabilities 裡另一個套件 key，必須繼續往下解析(多層 transitive)，
//   並把目前套件的 severity 併入繼續往下傳遞的 inheritedSeverity。
// - via 是物件且有可解析的 GHSA url → 這才是一個真正的 advisory，它的 severity(如果有)
//   跟沿路繼承的 inheritedSeverity 取較高值，不可以讓這個 leaf 節點的值蓋掉/降低 root 的
//   severity(這是先前版本的 fail-open bug：`item.severity || vuln.severity` 讓明確寫成
//   高於自己實際嚴重度的 leaf severity 直接覆蓋掉 root 的 critical)。
// - via 是物件但沒有 url/解不出 GHSA → 視為錯誤(無法解析)，fail closed。
// - 參照到 vulnerabilities 裡不存在的套件 → 懸空參照，fail closed。
// - 參照形成循環(A -> B -> A) → 偵測到就停止遞迴並回報錯誤，不會無窮迴圈，也 fail closed。
// - via 是空陣列 → 這個套件沒有任何可解析的 advisory，fail closed(不能因為沒東西可查就放行)。
// - 套件本身或 via 物件的 severity 是未知值(不在 SEVERITY_RANK 裡)→ fail closed。
function resolveAdvisoriesForPackage(pkgName, vulnerabilities, visited, inheritedSeverity) {
  if (visited.has(pkgName)) {
    return { advisories: [], errors: [`循環參照(cyclic via)：${[...visited, pkgName].join(' -> ')}`] }
  }
  const vuln = vulnerabilities[pkgName]
  if (!vuln || typeof vuln !== 'object') {
    return { advisories: [], errors: [`懸空參照(dangling via)：找不到套件 "${pkgName}" 的漏洞資料`] }
  }
  if (!isKnownSeverity(vuln.severity)) {
    return { advisories: [], errors: [`套件 "${pkgName}" 的 severity 未知或缺失：${JSON.stringify(vuln.severity)}`] }
  }

  const pathSeverity = inheritedSeverity == null ? vuln.severity : higherSeverity(inheritedSeverity, vuln.severity)

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
      const nested = resolveAdvisoriesForPackage(item, vulnerabilities, nextVisited, pathSeverity)
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
      if (item.severity !== undefined && !isKnownSeverity(item.severity)) {
        errors.push(`套件 "${pkgName}" 的 advisory severity 未知：${JSON.stringify(item.severity)}`)
        continue
      }
      // 有明確寫 severity 才拿來跟路徑目前的最高值比較取大；沒寫就單純沿用路徑的值，
      // 兩種情況都不會讓結果比 pathSeverity 低。
      const advisorySeverity = item.severity !== undefined ? higherSeverity(pathSeverity, item.severity) : pathSeverity
      advisories.push({
        package: pkgName,
        severity: advisorySeverity,
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
  if (advisory.severity !== 'high') return false // 只有 high 才可能被放行；critical 一律不放行
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
  const reasons = []

  // 任何套件(不只是要走訪的 root)出現無法識別或缺失的 severity，都視為資料不符預期，
  // fail closed——真實的 npm audit 輸出每個 vulnerability 一定有 severity 欄位，完全缺失
  // 本身就是異常資料，不能因為它「連判斷都不夠格當 root」就放過。
  for (const [name, v] of Object.entries(vulnerabilities)) {
    if (v && typeof v === 'object' && !isKnownSeverity(v.severity)) {
      reasons.push(`套件 "${name}" 的 severity 未知或缺失：${JSON.stringify(v.severity)}`)
    }
  }

  const rootPackages = Object.entries(vulnerabilities)
    .filter(([, v]) => v && (v.severity === 'high' || v.severity === 'critical'))
    .map(([name]) => name)

  // 嚴格驗證 metadata：必須存在、high/critical 必須是非負整數、critical > 0 一律失敗、
  // 且 vulnerabilities 裡實際 severity=high/critical 的套件數必須跟 metadata 完全一致——
  // 這是先前版本 Bug A 的根因(metadata.critical 只有在 rootPackages.length===0 才會被檢查，
  // 導致「metadata 說有 critical，但 vulnerabilities 裡剛好有別的 high 項目」這種情況被
  // 誤判成通過)。
  const metaVuln = data.metadata?.vulnerabilities
  if (!metaVuln || typeof metaVuln !== 'object') {
    reasons.push('npm audit JSON 缺少 metadata.vulnerabilities，無法確認 high/critical 數量是否吻合，fail closed')
  } else {
    const metaHigh = metaVuln.high
    const metaCritical = metaVuln.critical
    const highValid = isNonNegativeInteger(metaHigh)
    const criticalValid = isNonNegativeInteger(metaCritical)
    if (!highValid) reasons.push(`metadata.vulnerabilities.high 不是非負整數：${JSON.stringify(metaHigh)}`)
    if (!criticalValid) reasons.push(`metadata.vulnerabilities.critical 不是非負整數：${JSON.stringify(metaCritical)}`)
    if (criticalValid && metaCritical > 0) {
      reasons.push(`metadata 回報 ${metaCritical} 個 critical 漏洞，一律不放行(不受白名單影響，即使 vulnerabilities 裡的其他項目都已放行)`)
    }
    if (highValid && criticalValid) {
      const actualHighCount = rootPackages.filter((name) => vulnerabilities[name].severity === 'high').length
      const actualCriticalCount = rootPackages.filter((name) => vulnerabilities[name].severity === 'critical').length
      if (actualHighCount !== metaHigh) {
        reasons.push(`metadata.vulnerabilities.high=${metaHigh}，但 vulnerabilities 裡實際只有 ${actualHighCount} 個 severity=high 的套件，數量不吻合，fail closed`)
      }
      if (actualCriticalCount !== metaCritical) {
        reasons.push(`metadata.vulnerabilities.critical=${metaCritical}，但 vulnerabilities 裡實際只有 ${actualCriticalCount} 個 severity=critical 的套件，數量不吻合，fail closed`)
      }
    }
  }

  const advisoryMap = new Map() // key: package::ghsaId -> advisory(severity 取所有路徑的最高值)
  for (const root of rootPackages) {
    const { advisories, errors } = resolveAdvisoriesForPackage(root, vulnerabilities, new Set(), null)
    for (const err of errors) reasons.push(`[${root}] ${err}`)
    for (const adv of advisories) {
      const key = `${adv.package}::${adv.ghsaId}`
      const existing = advisoryMap.get(key)
      advisoryMap.set(key, existing ? { ...existing, severity: higherSeverity(existing.severity, adv.severity) } : adv)
    }
  }
  const allAdvisories = [...advisoryMap.values()]

  if ((metaVuln?.high > 0 || metaVuln?.critical > 0) && rootPackages.length === 0) {
    reasons.push(
      `metadata 回報 high=${metaVuln?.high}/critical=${metaVuln?.critical}，但 vulnerabilities 裡找不到任何 `
      + 'severity 為 high/critical 的套件項目，資料可能不符預期格式',
    )
  }

  for (const advisory of allAdvisories) {
    if (advisory.severity !== 'high' && advisory.severity !== 'critical') continue
    if (!isAllowed(advisory, allowlistEntries, now)) {
      reasons.push(
        `未放行的 ${advisory.severity} 漏洞：${advisory.package} — ${advisory.title}`
        + (advisory.ghsaId ? ` (${advisory.ghsaId})` : ' (無法解析 GHSA id)')
        + ' — 不在白名單內，或白名單項目已過 reviewBy 到期日，或 severity 是 critical(一律不放行)',
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

  console.log('\n通過：所有 high/critical advisory 都已解析、都在白名單內且未過期，沒有 critical、沒有無法解析的參照，metadata 數量吻合。')
  process.exit(0)
}

// 用 pathToFileURL 而不是手動拼 `file://${path}` —— Windows 路徑含反斜線、且絕對路徑的
// file: URL 需要三個斜線，手動拼字串在 Windows 上會比對失敗，導致直接執行這個檔案時
// main() 沒被呼叫到。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
