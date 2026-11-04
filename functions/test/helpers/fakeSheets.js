// 測試用的假 Google Sheets client：實作 aiExportSync.js 注入的介面，行為盡量貼近真實 Sheets
// (格子大小限制、讀回時省略尾端空白儲存格、寫入後型別不變)，並可注入失敗/竄改，驗證保護機制。
export class FakeSheets {
  constructor() {
    this.tabs = new Map() // title -> { sheetId, rowCount, columnCount, rows: any[][] }
    this.nextId = 1
    this.calls = []        // [{ method, detail }]
    this.failures = []     // [{ method, nth(1-based, 可省略=每次), when?: (args)=>bool, error }]
    this.afterBatchUpdate = null // (fake) => void，用來模擬「寫入後內容被竄改/遺失」
    this._count = {}
  }

  _maybeFail(method, args) {
    this._count[method] = (this._count[method] || 0) + 1
    for (const f of this.failures) {
      if (f.method !== method) continue
      if (f.nth && f.nth !== this._count[method]) continue
      if (f.when && !f.when(args)) continue
      throw f.error || new Error(`injected failure: ${method}`)
    }
  }

  failOn(method, opts = {}) { this.failures.push({ method, ...opts }); return this }

  _tab(title) {
    const t = this.tabs.get(title)
    if (!t) throw new Error(`Unable to parse range: ${title}`)
    return t
  }

  static parseRange(range) {
    const m = /^(.+)!([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/.exec(range)
    if (!m) throw new Error(`bad range ${range}`)
    const col = (s) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0)
    return { title: m[1], c1: col(m[2]), r1: m[3] ? Number(m[3]) : 1, c2: m[4] ? col(m[4]) : null, r2: m[5] ? Number(m[5]) : null }
  }

  async getSheets() {
    this.calls.push({ method: 'getSheets' })
    this._maybeFail('getSheets')
    return [...this.tabs.entries()].map(([title, t]) => ({ title, sheetId: t.sheetId, rowCount: t.rowCount, columnCount: t.columnCount }))
  }
  async addTabs(titles) {
    this.calls.push({ method: 'addTabs', detail: titles })
    this._maybeFail('addTabs', titles)
    for (const title of titles) {
      if (this.tabs.has(title)) throw new Error('duplicate tab')
      this.tabs.set(title, { sheetId: this.nextId++, rowCount: 1000, columnCount: 26, rows: [] })
    }
  }
  async resizeSheets(list) {
    this.calls.push({ method: 'resizeSheets', detail: list })
    this._maybeFail('resizeSheets', list)
    for (const s of list) {
      const t = [...this.tabs.values()].find((x) => x.sheetId === s.sheetId)
      t.rowCount = s.rowCount
      t.columnCount = s.columnCount
    }
  }
  _read(range) {
    const { title, r1, r2, c2 } = FakeSheets.parseRange(range)
    const t = this._tab(title)
    const end = r2 ?? t.rows.length
    const out = t.rows.slice(r1 - 1, end).map((row) => {
      const cells = (row || []).slice(0, c2 ?? undefined).map((v) => (v === undefined ? '' : v))
      while (cells.length && cells[cells.length - 1] === '') cells.pop() // Sheets 讀回時會省略尾端空白儲存格
      return cells
    })
    while (out.length && out[out.length - 1].length === 0) out.pop()
    return out
  }
  async getValues(range) {
    this.calls.push({ method: 'getValues', detail: range })
    this._maybeFail('getValues', range)
    return this._read(range)
  }
  async batchGetValues(ranges) {
    this.calls.push({ method: 'batchGetValues', detail: ranges })
    this._maybeFail('batchGetValues', ranges)
    return ranges.map((r) => this._read(r))
  }
  async batchClear(ranges) {
    this.calls.push({ method: 'batchClear', detail: ranges })
    this._maybeFail('batchClear', ranges)
    for (const r of ranges) this._tab(FakeSheets.parseRange(r).title).rows = []
  }
  async batchUpdate(data) {
    this.calls.push({ method: 'batchUpdate', detail: data.map((d) => d.range) , status: data.length === 1 && data[0].range.startsWith('AI_Sync_Status') ? data[0].values.find((r) => r[0] === 'status')?.[1] : undefined })
    this._maybeFail('batchUpdate', data)
    for (const d of data) {
      const { title } = FakeSheets.parseRange(d.range)
      const t = this._tab(title)
      if (d.values.length > t.rowCount) throw new Error(`Range ${d.range} exceeds grid limits. Max rows: ${t.rowCount}`)
      if (d.values.some((r) => r.length > t.columnCount)) throw new Error('exceeds grid limits (columns)')
      t.rows = d.values.map((r) => [...r])
    }
    if (this.afterBatchUpdate) this.afterBatchUpdate(this, data)
  }

  // 測試輔助
  statusMap() {
    const m = {}
    for (const r of this.tabs.get('AI_Sync_Status')?.rows || []) if (r[0]) m[r[0]] = r[1]
    return m
  }
  rows(title) { return this.tabs.get(title)?.rows || [] }
  dump() { return JSON.stringify([...this.tabs.entries()].map(([k, v]) => [k, v.rows])) }
}
