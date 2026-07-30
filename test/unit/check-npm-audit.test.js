// 測試 scripts/check-npm-audit.mjs 的純函式 evaluateAudit —— 不會真的呼叫 npm audit，
// 直接餵捏造的 npm audit --json 輸出字串，涵蓋 5 種必要情境。
import { describe, it, expect } from 'vitest'
import { evaluateAudit } from '../../scripts/check-npm-audit.mjs'

const ALLOWLIST = [
  {
    ghsaId: 'GHSA-qwww-vcr4-c8h2',
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

function highVuln(pkg, ghsaId, title = '(test advisory)') {
  return {
    [pkg]: {
      name: pkg,
      severity: 'high',
      via: [{ source: 1, name: pkg, dependency: pkg, title, url: `https://github.com/advisories/${ghsaId}`, severity: 'high' }],
      effects: [],
      range: '1.0.0',
      nodes: [`node_modules/${pkg}`],
    },
  }
}

function criticalVuln(pkg, ghsaId, title = '(test critical advisory)') {
  return {
    [pkg]: {
      name: pkg,
      severity: 'critical',
      via: [{ source: 1, name: pkg, dependency: pkg, title, url: `https://github.com/advisories/${ghsaId}`, severity: 'critical' }],
      effects: [],
      range: '1.0.0',
      nodes: [`node_modules/${pkg}`],
    },
  }
}

describe('evaluateAudit', () => {
  it('1. 只有已允許的 GHSA(套件/等級/id 都對得上，且未過期)→ 成功', () => {
    const json = auditJson({ vulnerabilities: highVuln('react-router', 'GHSA-qwww-vcr4-c8h2'), high: 1 })
    const result = evaluateAudit(json, ALLOWLIST, { now: new Date('2026-08-01') })
    expect(result.ok).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('2. 新的 high advisory(不在白名單內)→ 失敗', () => {
    const json = auditJson({ vulnerabilities: highVuln('lodash', 'GHSA-aaaa-bbbb-cccc'), high: 1 })
    const result = evaluateAudit(json, ALLOWLIST, { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('lodash'))).toBe(true)
  })

  it('3. critical advisory → 失敗，即使剛好也列在白名單裡(critical 一律不放行)', () => {
    const allowlistWithCritical = [
      ...ALLOWLIST,
      { ghsaId: 'GHSA-critical-1', package: 'evil-pkg', severity: 'critical', reason: 'x', reviewedAt: '2026-07-30', reviewBy: '2099-01-01' },
    ]
    const json = auditJson({ vulnerabilities: criticalVuln('evil-pkg', 'GHSA-critical-1'), critical: 1 })
    const result = evaluateAudit(json, allowlistWithCritical, { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('critical'))).toBe(true)
  })

  it('4. malformed audit JSON → 失敗', () => {
    const result = evaluateAudit('{ this is not valid json', ALLOWLIST, { now: new Date('2026-08-01') })
    expect(result.ok).toBe(false)
    expect(result.reasons[0]).toMatch(/不是合法的 JSON/)
  })

  it('5. audit command 執行失敗／無輸出(null 或空字串)→ 失敗', () => {
    const resultNull = evaluateAudit(null, ALLOWLIST, { now: new Date('2026-08-01') })
    expect(resultNull.ok).toBe(false)
    expect(resultNull.reasons[0]).toMatch(/沒有任何輸出/)

    const resultEmpty = evaluateAudit('   ', ALLOWLIST, { now: new Date('2026-08-01') })
    expect(resultEmpty.ok).toBe(false)
  })

  // ── 額外的邊界情境(補強上面 5 個必要案例) ──────────────────────────
  it('白名單項目已過 reviewBy 到期日 → 視為未放行，失敗', () => {
    const json = auditJson({ vulnerabilities: highVuln('react-router', 'GHSA-qwww-vcr4-c8h2'), high: 1 })
    const result = evaluateAudit(json, ALLOWLIST, { now: new Date('2027-01-01') }) // 晚於 reviewBy 2026-10-30
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('react-router'))).toBe(true)
  })

  it('白名單項目套件名稱對不上(同一個 GHSA id 但不同套件)→ 不放行', () => {
    const json = auditJson({ vulnerabilities: highVuln('some-other-pkg', 'GHSA-qwww-vcr4-c8h2'), high: 1 })
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
    const result = evaluateAudit(json, ALLOWLIST, { now: new Date('2026-08-01') })
    expect(result.ok).toBe(true)
  })

  it('moderate/low severity 的 advisory 不受白名單規範，永遠不會被擋', () => {
    const json = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: {
        'some-pkg': {
          name: 'some-pkg',
          severity: 'moderate',
          via: [{ source: 1, name: 'some-pkg', title: 'moderate issue', url: 'https://github.com/advisories/GHSA-moderate-1', severity: 'moderate' }],
          effects: [], range: '1.0.0', nodes: ['node_modules/some-pkg'],
        },
      },
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 0, critical: 0, total: 1 } },
    })
    const result = evaluateAudit(json, [], { now: new Date('2026-08-01') })
    expect(result.ok).toBe(true)
  })
})
