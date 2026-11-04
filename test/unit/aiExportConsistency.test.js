import { describe, it, expect } from 'vitest'
import { overdueDays, OVERDUE_WATCH_STATUSES } from '../../src/utils/requestActions.js'
import {
  buildSnapshot, itemCode, TAB, OVERDUE_WATCH_STATUSES as EXPORT_WATCH,
} from '../../functions/aiExport.js'
import { KEY, NOW, TODAY, users, people, requests, projects } from '../../functions/test/helpers/aiExportFixtures.js'

// AI 資料表(functions/aiExport.js)的「逾期」口徑必須與前端需求總表的紅字逾期一致。
// functions/ 是獨立部署單元(不能 import src/)，所以兩邊各維護一份，這個測試負責對照，改一邊忘了改另一邊會立刻失敗。
describe('AI 資料表口徑與既有前端一致', () => {
  it('逾期監控狀態清單相同', () => {
    expect([...EXPORT_WATCH].sort()).toEqual([...OVERDUE_WATCH_STATUSES].sort())
  })

  it('同一批資料：逾期的需求與逾期天數與前端 overdueDays 完全相同', () => {
    const snap = buildSnapshot({ requests, projects, users, people, now: NOW, hmacKey: KEY, anonymize: true })
    const header = snap.tabs[TAB.REQUESTS][1]
    const rows = snap.tabs[TAB.REQUESTS].slice(2)
    const byCode = new Map(rows.map((r) => [r[0], r]))
    for (const r of requests) {
      const row = byCode.get(itemCode('R', r.id, KEY))
      if (!row) continue // 不在保留範圍
      const mine = row[header.indexOf('overdueDays')]
      expect(mine, `${r.id}(${r.status}, due ${r.dueDate})`).toBe(overdueDays(r, TODAY))
      expect(row[header.indexOf('isOverdue')]).toBe(overdueDays(r, TODAY) > 0)
    }
  })
})
