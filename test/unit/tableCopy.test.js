import { describe, it, expect } from 'vitest'
import { tableToHtml, tableToText, statsToTable, requestsToTable } from '../../src/utils/tableCopy.js'
import { buildMonthlyStats } from '../../src/utils/requestUrgency.js'

const at = (y, m, d) => new Date(y, m - 1, d, 10)
const req = (o) => ({ status: 'assigned', region: 'HQ', urgent: false, dueDate: '2026-12-30', createdAt: at(2026, 11, 3), projectName: 'P', ...o })

describe('tableToHtml / tableToText', () => {
  const t = { title: '標題', headers: ['月份', 'HQ'], rows: [['1 月', { text: '2', sub: '急件 1' }], ['2 月', '-']], foot: [['全年', '2']], note: '備註' }
  it('HTML 是有框線的 table，含標題、表頭、急件紅字', () => {
    const h = tableToHtml(t)
    expect(h).toContain('<table')
    expect(h).toContain('border:1px solid')
    expect(h.match(/<tr>/g).length).toBe(4)       // 表頭 + 2 列 + 合計
    expect(h).toContain('標題')
    expect(h).toContain('(急件 1)')
    expect(h).toContain('color:#dc2626')
  })
  it('會跳脫 HTML 特殊字元(專案名稱不能把表格弄壞或注入標籤)', () => {
    const h = tableToHtml({ headers: ['a'], rows: [['<b>"x"</b> & y']] })
    expect(h).not.toContain('<b>')
    expect(h).toContain('&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; y')
  })
  it('純文字：Tab 分隔、急件放括號', () => {
    expect(tableToText(t)).toBe('標題\n月份\tHQ\n1 月\t2(急件 1)\n2 月\t-\n全年\t2\n備註')
  })
})

describe('statsToTable', () => {
  const stats = buildMonthlyStats([
    req({ region: 'HQ', dueDate: '2026-11-06' }),
    req({ region: 'HQ' }),
    req({ region: 'US', createdAt: at(2026, 10, 5) }),
  ], 2026)
  const t = statsToTable(stats, 2026)
  it('表頭 = 月份 + 有資料的地區 + 合計 + 急件；共 12 個月列與 1 列全年', () => {
    expect(t.headers).toEqual(['月份', 'HQ', 'US', '合計', '急件'])
    expect(t.rows.length).toBe(12)
    expect(t.foot.length).toBe(1)
    expect(t.title).toBe('2026 年每月各地區發稿統計')
  })
  it('11 月 HQ = 2 件、其中 1 件急件；沒資料的格子是 -', () => {
    const nov = t.rows[10]
    expect(nov[0]).toBe('11 月')
    expect(nov[1]).toEqual({ text: '2', sub: '急件 1' })
    expect(nov[2]).toBe('-')
    expect(t.rows[0][1]).toBe('-')
  })
  it('全年列合計正確', () => {
    expect(t.foot[0][0]).toBe('全年')
    expect(t.foot[0][3]).toBe('3')
  })
})

describe('requestsToTable', () => {
  it('明細列帶發稿日、交期、間隔天數、急件、狀態名稱', () => {
    const t = requestsToTable([req({ dueDate: '2026-11-06', projectName: 'HQ_A' })], '標題')
    expect(t.headers).toContain('間隔(天)')
    expect(t.rows[0].slice(0, 5)).toEqual(['HQ_A', 'HQ', '2026-11-03', '2026-11-06', '3'])
    expect(t.rows[0][5]).toMatchObject({ text: '是', tone: 'red' })
    expect(t.rows[0][6]).toBe('已發稿')
  })
  it('手動勾選的急件標註(手動)；非急件為空字串', () => {
    const t = requestsToTable([req({ urgent: true }), req({})], 'x')
    expect(t.rows[0][5].text).toBe('是(手動)')
    expect(t.rows[1][5]).toBe('')
  })
})
