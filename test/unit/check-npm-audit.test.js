// 測試 scripts/check-npm-audit.mjs 的純函式：evaluateAudit(遞迴解析 via + 白名單比對)、
// validateAllowlistEntries(白名單 schema 驗證)、validateSpawnResult(spawnSync 結果驗證)。
// 全部不會真的呼叫 npm audit、不會讀檔——直接餵捏造的 JSON/物件，涵蓋題目要求的所有情境。
import { describe, it, expect } from 'vitest'
import { evaluateAudit, validateAllowlistEntries, validateSpawnResult } from '../../scripts/check-npm-audit.mjs'

const ALLOWLIST = [
  {
    ghsa: 'GHSA-qwww-vcr4-c8h2',
    package: 'react-router',
    severity: 'high',
    reason: 'RSC-only 攻擊面，這個 app 沒有用 RSC/SSR',
    reviewedAt: '2026-07-30',
    reviewBy: '2026-10-30',
  },
]

function auditJson({ vulnerabilities = {}, critical = 0, high = 0 }) {
  return JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities,
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high, critical, total: high + critical } },
  })
}

function advisoryObj(ghsaId, severity = 'high', title = '(test advisory)') {
  return { source: 1, title, url: `https://github.com/advisories/${ghsaId}`, severity }
}

describe('evaluateAudit — 基本情境', () => {
  it('1. 只有已允許的 GHSA(套件/等級/id 都對得上，且未過期)→ 成功', () => {
    const json = auditJson({
      vulnerabilities: { 'react-router': { name: 'react-router', severity: 'high', via: [advisoryObj('GHSA-qwww-vcr4-c8h2')] } },
      high: 1,
    })
    const result = evaluateAudit(json, ALLOWLIST, { now: new Date('2026-08-01') })
    expect(result.ok).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('2. 新的 high advisory(不在白名單內)→ 失敗', () => {
    const json = auditJson({
      vulnerabilities: { lodash: { name: 'lodash', severity: 'high', via: [advisoryObj('GHSA-aaaa-bbbb-cccc')] } },
      high: 1,
    })
    const result = evaluateAudit(json, ALLOWLIST, { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('lodash'))).toBe(true)
  })

  it('3. critical advisory → 失敗，即使剛好也列在「假設」白名單裡(critical 一律不放行)', () => {
    const allowlistWithCritical = [
      ...ALLOWLIST,
      { ghsa: 'GHSA-crit-0001-aaaa', package: 'evil-pkg', severity: 'high', reason: 'x', reviewedAt: '2026-07-30', reviewBy: '2099-01-01' },
    ]
    const json = auditJson({
      vulnerabilities: { 'evil-pkg': { name: 'evil-pkg', severity: 'critical', via: [advisoryObj('GHSA-crit-0001-aaaa', 'critical')] } },
      critical: 1,
    })
    const result = evaluateAudit(json, allowlistWithCritical, { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
  })

  it('4. malformed audit JSON → 失敗', () => {
    const result = evaluateAudit('{ this is not valid json', ALLOWLIST, { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
    expect(result.reasons[0]).toMatch(/不是合法的 JSON/)
  })

  it('5. audit command 執行失敗／無輸出(null 或空字串)→ 失敗', () => {
    expect(evaluateAudit(null, ALLOWLIST, { now: new Date('2026-08-01') }).ok).toBe(false)
    expect(evaluateAudit('   ', ALLOWLIST, { now: new Date('2026-08-01') }).ok).toBe(false)
  })
})

describe('evaluateAudit — 遞迴解析 via（transitive / 循環 / 懸空）', () => {
  it('via: [] 且 metadata.high > 0 → 失敗(不能因為沒東西可查就放行)', () => {
    const json = auditJson({
      vulnerabilities: { 'some-pkg': { name: 'some-pkg', severity: 'high', via: [] } },
      high: 1,
    })
    const result = evaluateAudit(json, [], { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('via 是空陣列'))).toBe(true)
  })

  it('純字串 via（間接依賴，指向另一個套件 key）→ 正確解析出底層的 advisory', () => {
    const json = auditJson({
      vulnerabilities: {
        'react-router-dom': { name: 'react-router-dom', severity: 'high', via: ['react-router'] },
        'react-router': { name: 'react-router', severity: 'high', via: [advisoryObj('GHSA-qwww-vcr4-c8h2')] },
      },
      high: 2,
    })
    const result = evaluateAudit(json, ALLOWLIST, { now: new Date('2026-08-01') })
    expect(result.ok).toBe(true)
    // react-router-dom 跟 react-router 兩個 root 都會解析到同一個 advisory，dedupe 後只有一筆
    expect(result.advisories.length).toBe(1)
    expect(result.advisories[0].package).toBe('react-router')
  })

  it('多層 transitive via（A -> B -> C -> 真正的 advisory）→ 正確往下解析', () => {
    const json = auditJson({
      vulnerabilities: {
        A: { name: 'A', severity: 'high', via: ['B'] },
        B: { name: 'B', severity: 'moderate', via: ['C'] },
        C: { name: 'C', severity: 'moderate', via: [advisoryObj('GHSA-deep-chai-n001')] },
      },
      high: 1,
    })
    const allowlist = [{ ghsa: 'GHSA-deep-chai-n001', package: 'C', severity: 'high', reason: 'x', reviewedAt: '2026-07-01', reviewBy: '2027-01-01' }]
    const result = evaluateAudit(json, allowlist, { now: new Date('2026-08-01') })
    expect(result.ok).toBe(true)
    expect(result.advisories[0].package).toBe('C')
  })

  it('dangling via（指向 vulnerabilities 裡不存在的套件）→ 失敗', () => {
    const json = auditJson({
      vulnerabilities: { A: { name: 'A', severity: 'high', via: ['does-not-exist'] } },
      high: 1,
    })
    const result = evaluateAudit(json, [], { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('懸空參照'))).toBe(true)
  })

  it('cyclic via（A -> B -> A）→ 偵測到循環並失敗，不會無窮遞迴掛住', () => {
    const json = auditJson({
      vulnerabilities: {
        A: { name: 'A', severity: 'high', via: ['B'] },
        B: { name: 'B', severity: 'high', via: ['A'] },
      },
      high: 2,
    })
    const result = evaluateAudit(json, [], { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('循環參照'))).toBe(true)
  })

  it('自我參照(A 的 via 直接包含 "A" 自己)→ 偵測到循環並失敗', () => {
    const json = auditJson({
      vulnerabilities: { A: { name: 'A', severity: 'high', via: ['A'] } },
      high: 1,
    })
    const result = evaluateAudit(json, [], { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('循環參照'))).toBe(true)
  })

  it('同一個 high 漏洞的 via 解析出多個 advisory → 兩個都要在白名單才會過，缺一就失敗', () => {
    const json = auditJson({
      vulnerabilities: {
        A: { name: 'A', severity: 'high', via: [advisoryObj('GHSA-one0-0000-0001'), advisoryObj('GHSA-two0-0000-0002')] },
      },
      high: 1,
    })
    const onlyOneAllowed = [
      { ghsa: 'GHSA-one0-0000-0001', package: 'A', severity: 'high', reason: 'x', reviewedAt: '2026-07-01', reviewBy: '2027-01-01' },
    ]
    const result = evaluateAudit(json, onlyOneAllowed, { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
    expect(result.advisories.length).toBe(2)

    const bothAllowed = [
      ...onlyOneAllowed,
      { ghsa: 'GHSA-two0-0000-0002', package: 'A', severity: 'high', reason: 'x', reviewedAt: '2026-07-01', reviewBy: '2027-01-01' },
    ]
    expect(evaluateAudit(json, bothAllowed, { now: new Date('2026-08-01') }).ok).toBe(true)
  })

  it('未知/無法解析的 advisory(沒有 url，或 url 解不出 GHSA)→ 失敗', () => {
    const noUrlJson = auditJson({
      vulnerabilities: { A: { name: 'A', severity: 'high', via: [{ title: 'no url here', severity: 'high' }] } },
      high: 1,
    })
    expect(evaluateAudit(noUrlJson, [], { now: new Date('2026-08-01') }).ok).toBe(false)

    const badUrlJson = auditJson({
      vulnerabilities: { A: { name: 'A', severity: 'high', via: [{ title: 'x', url: 'https://example.com/not-an-advisory', severity: 'high' }] } },
      high: 1,
    })
    expect(evaluateAudit(badUrlJson, [], { now: new Date('2026-08-01') }).ok).toBe(false)
  })

  it('metadata 回報 high>0 但 vulnerabilities 裡完全沒有 high/critical 套件 → 失敗(資料不符預期)', () => {
    const json = auditJson({ vulnerabilities: { A: { name: 'A', severity: 'moderate', via: [] } }, high: 1 })
    const result = evaluateAudit(json, [], { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('metadata 回報'))).toBe(true)
  })
})

describe('evaluateAudit — severity 正確性(先前兩個 fail-open bug 的迴歸測試)', () => {
  it('Bug A 迴歸：metadata.critical=1，但 vulnerabilities 裡只有一個已放行的 high → 失敗', () => {
    // 先前版本只有在 rootPackages.length===0 時才檢查 metadata.critical，這裡故意讓
    // rootPackages 非空(react-router 是 high)，但 metadata 另外回報了 1 個 critical——
    // 舊版會誤判成功，因為它從來沒去看 metadata.critical 這個數字本身。
    const json = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: { 'react-router': { name: 'react-router', severity: 'high', via: [advisoryObj('GHSA-qwww-vcr4-c8h2')] } },
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 1, total: 2 } },
    })
    const result = evaluateAudit(json, ALLOWLIST, { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('critical'))).toBe(true)
  })

  it('Bug B 迴歸：root severity 是 critical，但 via advisory 物件的 severity 被標成 high → 仍判定為 critical，失敗', () => {
    // 先前版本用 `item.severity || vuln.severity`，advisory 物件明確寫 severity:'high' 時
    // 會直接蓋掉 root 的 'critical'，讓一個實際上是 critical 的漏洞被誤判成 high 去跟白名單比對。
    const json = auditJson({
      vulnerabilities: {
        'evil-pkg': { name: 'evil-pkg', severity: 'critical', via: [advisoryObj('GHSA-down-grad-e001', 'high')] },
      },
      critical: 1,
    })
    // 即使白名單「假設」放行了這個 GHSA(severity 寫 high)，也不該通過，因為真正的 severity 是 critical
    const allowlistTryingToAllow = [
      { ghsa: 'GHSA-down-grad-e001', package: 'evil-pkg', severity: 'high', reason: 'x', reviewedAt: '2026-07-01', reviewBy: '2027-01-01' },
    ]
    const result = evaluateAudit(json, allowlistTryingToAllow, { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
    const advisory = result.advisories.find((a) => a.ghsaId === 'GHSA-down-grad-e001')
    expect(advisory.severity).toBe('critical')
  })

  it('root high + via advisory 標成 moderate → 不會被降級，仍照 high 檢查(有放行就過)', () => {
    const json = auditJson({
      vulnerabilities: {
        'some-pkg': { name: 'some-pkg', severity: 'high', via: [advisoryObj('GHSA-stay-high-0001', 'moderate')] },
      },
      high: 1,
    })
    const allowlist = [{ ghsa: 'GHSA-stay-high-0001', package: 'some-pkg', severity: 'high', reason: 'x', reviewedAt: '2026-07-01', reviewBy: '2027-01-01' }]
    const result = evaluateAudit(json, allowlist, { now: new Date('2026-08-01') })
    expect(result.advisories[0].severity).toBe('high')
    expect(result.ok).toBe(true)
  })

  it('多層 transitive：critical -> high -> moderate -> 最終仍是 critical', () => {
    const json = auditJson({
      vulnerabilities: {
        A: { name: 'A', severity: 'critical', via: ['B'] },
        B: { name: 'B', severity: 'high', via: ['C'] },
        C: { name: 'C', severity: 'moderate', via: [advisoryObj('GHSA-chain-crit-001', 'moderate')] },
      },
      critical: 1,
    })
    const result = evaluateAudit(json, [], { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
    expect(result.advisories[0].severity).toBe('critical')
  })

  it('metadata.high=2，但實際只有 1 個 high 套件 → 失敗', () => {
    const json = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: { 'react-router': { name: 'react-router', severity: 'high', via: [advisoryObj('GHSA-qwww-vcr4-c8h2')] } },
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0, total: 2 } },
    })
    const result = evaluateAudit(json, ALLOWLIST, { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('數量不吻合'))).toBe(true)
  })

  it('metadata.critical=1，但實際沒有任何 critical 套件 → 失敗', () => {
    const json = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: { 'react-router': { name: 'react-router', severity: 'high', via: [advisoryObj('GHSA-qwww-vcr4-c8h2')] } },
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 1, total: 2 } },
    })
    const result = evaluateAudit(json, ALLOWLIST, { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
  })

  it('metadata 整個缺失 → 失敗', () => {
    const json = JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} })
    const result = evaluateAudit(json, [], { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('metadata.vulnerabilities'))).toBe(true)
  })

  it('metadata.high/critical 是字串/負數/小數/null → 失敗', () => {
    const badValues = ['1', -1, 1.5, null]
    for (const bad of badValues) {
      const json = JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: {},
        metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: bad, critical: 0, total: 0 } },
      })
      expect(evaluateAudit(json, [], { now: new Date('2026-08-01') }).ok, `high=${JSON.stringify(bad)} 應該失敗`).toBe(false)

      const json2 = JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: {},
        metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: bad, total: 0 } },
      })
      expect(evaluateAudit(json2, [], { now: new Date('2026-08-01') }).ok, `critical=${JSON.stringify(bad)} 應該失敗`).toBe(false)
    }
  })

  it('unknown/missing 的 vulnerability severity → 失敗', () => {
    const missingJson = auditJson({ vulnerabilities: { A: { name: 'A', via: [] } }, high: 0 })
    expect(evaluateAudit(missingJson, [], { now: new Date('2026-08-01') }).ok).toBe(false)

    const unknownJson = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: { A: { name: 'A', severity: 'banana', via: [] } },
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
    })
    const result = evaluateAudit(unknownJson, [], { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('未知或缺失'))).toBe(true)
  })

  it('metadata 與 vulnerabilities 完全一致的真實 npm audit 輸出(react-router-dom -> react-router 鏈)仍然通過', () => {
    // 逐字對應本專案實際跑出的 npm audit --json 形狀(見 scripts/check-npm-audit.mjs 開發時
    // 擷取的真實輸出)：react-router-dom 是直接依賴、經由字串 via 指向 react-router，
    // react-router 才是真正帶 advisory 物件的那個。
    const json = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: {
        'react-router': {
          name: 'react-router', severity: 'high', isDirect: false,
          via: [advisoryObj('GHSA-qwww-vcr4-c8h2', 'high', 'React Router: RSC Mode CSRF Bypass Allows Action Execution Before 400 Response')],
          effects: ['react-router-dom'], range: '7.12.0 - 8.2.0', nodes: ['node_modules/react-router'],
        },
        'react-router-dom': {
          name: 'react-router-dom', severity: 'high', isDirect: true,
          via: ['react-router'], effects: [], range: '>=7.12.0-pre.0', nodes: ['node_modules/react-router-dom'],
        },
      },
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0, total: 2 } },
    })
    const result = evaluateAudit(json, ALLOWLIST, { now: new Date('2026-08-01') })
    expect(result.ok).toBe(true)
    expect(result.reasons).toEqual([])
  })
})

describe('evaluateAudit — 白名單過期/套件不符', () => {
  it('白名單項目已過 reviewBy 到期日 → 視為未放行，失敗', () => {
    const json = auditJson({
      vulnerabilities: { 'react-router': { name: 'react-router', severity: 'high', via: [advisoryObj('GHSA-qwww-vcr4-c8h2')] } },
      high: 1,
    })
    const result = evaluateAudit(json, ALLOWLIST, { now: new Date('2027-01-01') }) // 晚於 reviewBy 2026-10-30
    expect(result.ok).toBe(false)
  })

  it('白名單項目套件名稱對不上(同一個 GHSA id 但不同套件)→ 不放行', () => {
    const json = auditJson({
      vulnerabilities: { 'some-other-pkg': { name: 'some-other-pkg', severity: 'high', via: [advisoryObj('GHSA-qwww-vcr4-c8h2')] } },
      high: 1,
    })
    const result = evaluateAudit(json, ALLOWLIST, { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
  })

  it('沒有 vulnerabilities 欄位的 JSON(格式不符預期)→ 失敗', () => {
    const result = evaluateAudit(JSON.stringify({ foo: 'bar' }), ALLOWLIST, { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
    expect(result.reasons[0]).toMatch(/vulnerabilities/)
  })

  it('完全沒有漏洞的乾淨 audit 結果 → 成功', () => {
    const json = auditJson({ vulnerabilities: {}, high: 0, critical: 0 })
    expect(evaluateAudit(json, ALLOWLIST, { now: new Date('2026-08-01') }).ok).toBe(true)
  })

  it('moderate/low severity 的 advisory 不受白名單規範，永遠不會被擋', () => {
    const json = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: { 'some-pkg': { name: 'some-pkg', severity: 'moderate', via: [advisoryObj('GHSA-mod0-0000-0001', 'moderate')] } },
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 0, critical: 0, total: 1 } },
    })
    expect(evaluateAudit(json, [], { now: new Date('2026-08-01') }).ok).toBe(true)
  })
})

describe('validateAllowlistEntries — schema 驗證', () => {
  const base = {
    ghsa: 'GHSA-abcd-efgh-ijkl',
    package: 'foo',
    severity: 'high',
    reason: '合理的理由',
    reviewedAt: '2026-01-01',
    reviewBy: '2026-06-01',
  }

  it('完全合法的一筆 → 通過', () => {
    expect(validateAllowlistEntries([base]).ok).toBe(true)
  })

  it('缺少 reason → 失敗', () => {
    const { reason: _reason, ...rest } = base
    expect(validateAllowlistEntries([rest]).ok).toBe(false)
  })

  it('缺少 reviewedAt → 失敗', () => {
    const { reviewedAt: _reviewedAt, ...rest } = base
    expect(validateAllowlistEntries([rest]).ok).toBe(false)
  })

  it('缺少 reviewBy → 失敗（不可被視為永久放行）', () => {
    const { reviewBy: _reviewBy, ...rest } = base
    const result = validateAllowlistEntries([rest])
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('reviewBy'))).toBe(true)
  })

  it('無效日期格式(reviewedAt)→ 失敗', () => {
    expect(validateAllowlistEntries([{ ...base, reviewedAt: 'not-a-date' }]).ok).toBe(false)
  })

  it('日期格式對但數值不合法(例如 2026-13-45)→ 失敗', () => {
    expect(validateAllowlistEntries([{ ...base, reviewBy: '2026-13-45' }]).ok).toBe(false)
  })

  it('reviewedAt 晚於 reviewBy → 失敗', () => {
    expect(validateAllowlistEntries([{ ...base, reviewedAt: '2026-12-01', reviewBy: '2026-06-01' }]).ok).toBe(false)
  })

  it('ghsa 格式不符 → 失敗', () => {
    expect(validateAllowlistEntries([{ ...base, ghsa: 'not-a-ghsa-id' }]).ok).toBe(false)
  })

  it('package 是空字串 → 失敗', () => {
    expect(validateAllowlistEntries([{ ...base, package: '' }]).ok).toBe(false)
  })

  it('severity 是 critical → 失敗(allowlist 不得包含 critical)', () => {
    expect(validateAllowlistEntries([{ ...base, severity: 'critical' }]).ok).toBe(false)
  })

  it('severity 必須恰好是 "high"：banana/moderate/數字/null/缺少/undefined 全部視為 malformed', () => {
    expect(validateAllowlistEntries([{ ...base, severity: 'banana' }]).ok).toBe(false)
    expect(validateAllowlistEntries([{ ...base, severity: 'moderate' }]).ok).toBe(false)
    expect(validateAllowlistEntries([{ ...base, severity: 3 }]).ok).toBe(false)
    expect(validateAllowlistEntries([{ ...base, severity: null }]).ok).toBe(false)
    expect(validateAllowlistEntries([{ ...base, severity: undefined }]).ok).toBe(false)
    const { severity: _severity, ...noSeverity } = base
    expect(validateAllowlistEntries([noSeverity]).ok).toBe(false)
  })

  it('重複的 ghsa/package 組合 → 失敗', () => {
    const result = validateAllowlistEntries([base, { ...base, reason: 'another reason' }])
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('重複'))).toBe(true)
  })

  it('同一個 ghsa 但不同 package → 不算重複，允許', () => {
    expect(validateAllowlistEntries([base, { ...base, package: 'bar' }]).ok).toBe(true)
  })

  it('entries 不是陣列 → 失敗', () => {
    expect(validateAllowlistEntries('not an array').ok).toBe(false)
  })
})

describe('validateSpawnResult — spawnSync 結果驗證', () => {
  it('正常結束、exit code 0(無漏洞)→ 通過', () => {
    const result = validateSpawnResult({ status: 0, signal: null, error: undefined, stdout: '{}' })
    expect(result.ok).toBe(true)
    expect(result.stdout).toBe('{}')
  })

  it('正常結束、exit code 1(找到漏洞，交給 parser 判斷)→ 通過', () => {
    expect(validateSpawnResult({ status: 1, signal: null, stdout: '{"vulnerabilities":{}}' }).ok).toBe(true)
  })

  it('exit code 2(npm audit 自己出錯，不是「有漏洞」)→ 失敗', () => {
    const result = validateSpawnResult({ status: 2, signal: null, stdout: '' })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/非預期的 exit code/)
  })

  it('status 是 null(被中止但沒有 signal 資訊)→ 失敗', () => {
    expect(validateSpawnResult({ status: null, signal: null, stdout: '' }).ok).toBe(false)
  })

  it('signal 有值(被訊號中止)→ 失敗', () => {
    const result = validateSpawnResult({ status: null, signal: 'SIGTERM', stdout: '' })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/訊號中止/)
  })

  it('result.error 有值(指令根本沒能執行，例如找不到 npm)→ 失敗，且不會去讀 stdout/stderr', () => {
    const result = validateSpawnResult({ error: new Error('spawn npm ENOENT'), stdout: undefined, stderr: undefined })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/執行 npm audit 失敗/)
  })

  it('stdout 是空字串，即使 stderr 有內容，也不可以把 stderr 當成合法結果', () => {
    // validateSpawnResult 只回傳 result.stdout，呼叫端(main)絕對不會去讀/解析 result.stderr；
    // 這裡確認即使 stderr 塞了看似合法的 JSON，也完全不影響 validateSpawnResult 的回傳值。
    const result = validateSpawnResult({ status: 0, signal: null, stdout: '', stderr: '{"vulnerabilities":{}}' })
    expect(result.ok).toBe(true)
    expect(result.stdout).toBe('')
    // 而空字串的 stdout 交給 evaluateAudit 後，會被判定為「沒有任何輸出」而失敗——
    // 確認整條路徑串起來，stderr 內容不會被誤用。
    expect(evaluateAudit(result.stdout, [], {}).ok).toBe(false)
  })
})
