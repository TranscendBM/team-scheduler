// 把快照寫進 Google Sheets 的流程，以及「失敗時不會讓舊資料或半套資料被誤認為最新」的保護機制。
// 不 import firebase；Sheets 用注入的 client 操作(正式環境用 createSheetsClient，測試用假的)。
//
// ── 為什麼需要 commit marker ──
// Sheets API 沒有跨分頁交易。就算把所有分頁放進同一個 batchUpdate，也不應該把「全成全敗」當成
// 已被保證的事。所以採用「最後才標記成功」的做法：
//   1) 先把 AI_Sync_Status 寫成 UPDATING(dataTrusted=false，保留上一次成功的時間)
//   2) 清除並重寫各資料分頁(每個分頁第 1 列 #META 帶這一輪的 snapshotId)
//   3) 讀回所有資料分頁，重算 checksum，必須跟預期完全一致
//   4) 最後才把 AI_Sync_Status 寫成 OK(snapshotId、lastSuccessAt、各分頁列數與 checksum)
// 任何一步失敗 → 盡力寫成 FAILED(lastSuccessAt 保持舊值，dataTrusted=false)。
// 讀的人(ChatGPT)只信「status=OK 且各分頁 snapshotId 與 AI_Sync_Status 相同且 checksum 對得上」的資料，
// 所以即使第 2、3 步中途當機、連 FAILED 都寫不進去，狀態分頁會停在 UPDATING，
// 或停在「上一次的 OK 但各分頁 snapshotId 已不一致」，都能被辨認為不可信，不會被當成最新。
import { GoogleAuth } from 'google-auth-library'
import {
  TAB, DATA_TABS, SCHEMA_VERSION, canonRows, checksumRows, buildSnapshot, LimitError, PiiError,
} from './aiExport.js'
import { collectSourceData } from './aiExportSource.js'

const STATUS_ROWS = 40 // 狀態分頁固定高度：覆寫時補空列，不會殘留舊 key
const GRID_MARGIN = 50
const READBACK_MARGIN = 20 // 讀回時多讀幾列，若有殘留的舊列會讓 checksum 不符

export class SyncError extends Error {
  constructor(errorClass, message, cause) {
    super(message)
    this.name = 'SyncError'
    this.errorClass = errorClass
    this.cause = cause
  }
}
export class SanityError extends Error {
  constructor(msg) { super(msg); this.name = 'SanityError' }
}

export function classifyError(e) {
  if (e instanceof SyncError) return e.errorClass
  if (e instanceof LimitError) return 'LIMIT'
  if (e instanceof PiiError) return 'PII_GUARD'
  if (e instanceof SanityError) return 'SANITY'
  return 'UNKNOWN'
}

// ───────────────────────── 狀態分頁 ─────────────────────────
function kvPairs(state) {
  const { status, trusted, snapshotId, anonymize, attemptAt, prev, successAt, successSnapshotId, counts, rows, checksums, errorClass, errorNote } = state
  const pairs = [
    ['status', status, 'OK=資料可信；UPDATING/FAILED=資料不可信，請勿分析'],
    ['dataTrusted', trusted, '只有 status=OK 才是 true'],
    ['snapshotId', snapshotId, '本輪(或最近一次嘗試)的快照 ID；必須等於各資料分頁 #META 的 snapshotId'],
    ['schemaVersion', SCHEMA_VERSION, ''],
    ['anonymized', anonymize, ''],
    ['lastAttemptAt', attemptAt, 'UTC ISO'],
    ['lastSuccessAt', successAt ?? prev?.lastSuccessAt ?? '', '最近一次「完整驗證通過」的時間；超過 26 小時請視為過期'],
    ['lastSuccessSnapshotId', successSnapshotId ?? prev?.lastSuccessSnapshotId ?? '', ''],
    ['requestsInScope', counts?.requests ?? prev?.requestsInScope ?? '', '來源需求筆數(範圍內)'],
    ['projectsExported', counts?.projects ?? prev?.projectsExported ?? '', ''],
    ['errorClass', errorClass || '', ''],
    ['errorNote', errorNote || '', '只含錯誤類別與簡短訊息，不含資料內容'],
  ]
  for (const t of DATA_TABS) pairs.push([`rows.${t}`, rows?.[t] ?? '', '該分頁 #META 的 dataRows(表格型=資料筆數、不含表頭；版面型=#META 之後的總列數)'])
  for (const t of DATA_TABS) pairs.push([`checksum.${t}`, checksums?.[t] ?? '', '分頁內容(不含 #META 列以外)的 sha256；讀回驗證用'])
  return pairs
}

export function buildStatusRows(state) {
  const rows = [['key', 'value', 'note'], ...kvPairs(state)]
  while (rows.length < STATUS_ROWS) rows.push(['', '', ''])
  return rows
}

export function parseStatusRows(values) {
  const m = new Map()
  for (const r of values || []) if (r && r[0]) m.set(String(r[0]), r[1])
  const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v))
  return {
    status: m.get('status') ?? '',
    lastSuccessAt: m.get('lastSuccessAt') ? String(m.get('lastSuccessAt')) : '',
    lastSuccessSnapshotId: m.get('lastSuccessSnapshotId') ? String(m.get('lastSuccessSnapshotId')) : '',
    requestsInScope: num(m.get('requestsInScope')),
    projectsExported: num(m.get('projectsExported')),
  }
}

// 寫入前的合理性檢查：跟上一次「成功」的筆數比，異常就拒絕寫入(避免來源異常把好資料洗掉)
export function checkSanity(snapshot, prev) {
  const prevReq = prev?.requestsInScope
  if (prev?.lastSuccessAt && prevReq != null) {
    if (snapshot.counts.requests === 0 && prevReq > 0) {
      throw new SanityError(`來源需求為 0 筆，但上次成功同步有 ${prevReq} 筆；疑似讀取異常，中止寫入`)
    }
    if (prevReq >= 10 && snapshot.counts.requests < prevReq * 0.5) {
      throw new SanityError(`需求筆數由 ${prevReq} 驟降為 ${snapshot.counts.requests}(超過 50%)；中止寫入，請人工確認`)
    }
  }
}

// ───────────────────────── 同步主流程 ─────────────────────────
async function writeStatus(sheets, state) {
  await sheets.batchUpdate([{ range: `${TAB.STATUS}!A1`, values: buildStatusRows(state) }])
}

function wrapError(e, fallbackClass) {
  if (e instanceof SyncError) return e
  const c = classifyError(e)
  return new SyncError(c === 'UNKNOWN' ? fallbackClass : c, e?.message || String(e), e)
}

// 盡力把狀態寫成 FAILED(保留上一次成功的時間與筆數、dataTrusted=false)；這一步本身失敗也只回傳 false，
// 不遮蓋原始錯誤。prev 沒給就先讀一次，讀不到就「不寫」——寧可保持原狀，也不要把上次成功資訊洗掉。
async function markFailed(sheets, { attemptAt, snapshotId = '', anonymize = '', prev, error, fallbackClass = 'SHEETS_API' }) {
  try {
    const p = prev || parseStatusRows(await sheets.getValues(`${TAB.STATUS}!A1:C${STATUS_ROWS}`))
    const err = wrapError(error, fallbackClass)
    await writeStatus(sheets, {
      status: 'FAILED', trusted: false, snapshotId, anonymize, attemptAt, prev: p,
      errorClass: err.errorClass, errorNote: shortError(err),
    })
    return true
  } catch {
    return false
  }
}

export async function syncToSheet({ sheets, snapshot, now }) {
  const attemptAt = now.toISOString()
  const id = { attemptAt, snapshotId: snapshot.snapshotId, anonymize: snapshot.anonymize }

  // 0~1) 確認分頁/格子、讀上一次狀態、合理性檢查：任何一步失敗都沒碰資料，但要把狀態標成 FAILED，
  //      否則狀態分頁會還停在「昨天的 OK」，讀的人可能把昨天的資料當成今天的。
  let prev
  try {
    await ensureLayout(sheets, snapshot)
    prev = parseStatusRows(await sheets.getValues(`${TAB.STATUS}!A1:C${STATUS_ROWS}`))
    checkSanity(snapshot, prev)
  } catch (e) {
    await markFailed(sheets, { ...id, prev, error: e })
    throw wrapError(e, 'SHEETS_API')
  }

  // 2) 標記 UPDATING(從此刻起，資料視為不可信，直到最後的 OK)。不帶 counts/rows/checksums，
  //    保留上一次成功的數字(下一輪合理性檢查要用)。
  try {
    await writeStatus(sheets, { ...id, status: 'UPDATING', trusted: false, prev })
  } catch (e) {
    await markFailed(sheets, { ...id, prev, error: e })
    throw wrapError(e, 'SHEETS_API')
  }

  try {
    // 3) 清除並重寫資料分頁
    await sheets.batchClear(DATA_TABS.map((t) => `${t}!A:Z`))
    await sheets.batchUpdate(DATA_TABS.map((t) => ({ range: `${t}!A1`, values: snapshot.tabs[t] })))

    // 4) 讀回驗證：內容 checksum 與 snapshotId 都要對得上
    const readBack = await sheets.batchGetValues(DATA_TABS.map((t) => `${t}!A1:Z${snapshot.tabs[t].length + READBACK_MARGIN}`))
    DATA_TABS.forEach((t, i) => {
      const metaRow = canonRows(readBack[i])[0] || []
      if (metaRow[0] !== '#META' || metaRow[1] !== `snapshotId=${snapshot.snapshotId}`) {
        throw new SyncError('VERIFY_MISMATCH', `分頁 ${t} 的 snapshotId 不符`)
      }
      if (checksumRows(readBack[i]) !== snapshot.checksums[t]) {
        throw new SyncError('VERIFY_MISMATCH', `分頁 ${t} 讀回內容與預期不一致`)
      }
    })
  } catch (e) {
    await markFailed(sheets, { ...id, prev, error: e })
    throw wrapError(e, 'SHEETS_API')
  }

  // 5) 最後才標記 OK
  try {
    await writeStatus(sheets, {
      ...id, status: 'OK', trusted: true, prev,
      successAt: attemptAt, successSnapshotId: snapshot.snapshotId,
      counts: snapshot.counts, rows: snapshot.dataRowCounts, checksums: snapshot.checksums,
    })
  } catch (e) {
    // 資料已驗證通過，但沒能寫成 OK：狀態維持 UPDATING/FAILED(不可信)，對讀者是安全的方向，下一輪會重寫
    await markFailed(sheets, { ...id, prev, error: e })
    throw wrapError(e, 'SHEETS_API')
  }
  return { snapshotId: snapshot.snapshotId, counts: snapshot.counts, rows: snapshot.dataRowCounts }
}

function shortError(e) {
  const msg = String(e?.message || e || '').replace(/[\r\n]+/g, ' ').replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg
}

async function ensureLayout(sheets, snapshot) {
  const existing = await sheets.getSheets()
  const byTitle = new Map(existing.map((s) => [s.title, s]))
  const missing = [...DATA_TABS, TAB.STATUS].filter((t) => !byTitle.has(t))
  if (missing.length) await sheets.addTabs(missing)
  const after = missing.length ? await sheets.getSheets() : existing
  const resize = []
  for (const s of after) {
    const need = s.title === TAB.STATUS ? STATUS_ROWS : snapshot.tabs[s.title]?.length
    if (!need) continue
    const wantRows = need + READBACK_MARGIN + GRID_MARGIN
    if (s.rowCount < wantRows || s.columnCount < 26) {
      resize.push({ sheetId: s.sheetId, rowCount: Math.max(s.rowCount, wantRows), columnCount: Math.max(s.columnCount, 26) })
    }
  }
  if (resize.length) await sheets.resizeSheets(resize)
}

// ───────────────────────── 整合：讀 Firestore → 建快照 → 寫 Sheet ─────────────────────────
// db、sheets 都由外部注入。失敗時(任何階段)會盡力把狀態寫成 FAILED，並把錯誤往外丟，
// 由呼叫端(排程函式)決定寄通知信。
export async function runAiExport({ db, sheets, hmacKey, anonymize = true, includeProjects = false, now = new Date() }) {
  let snapshot
  try {
    const source = await collectSourceData(db, { now, includeProjects })
    snapshot = buildSnapshot({ ...source, now, hmacKey, anonymize, includeProjects })
  } catch (e) {
    // 還沒碰任何資料：只把狀態分頁標成 FAILED(保留上次成功時間)，讓讀的人知道這一輪沒更新成功
    await markFailed(sheets, { attemptAt: now.toISOString(), error: e, fallbackClass: 'SOURCE' })
    throw wrapError(e, 'SOURCE')
  }
  return syncToSheet({ sheets, snapshot, now })
}

// ───────────────────────── 真實 Sheets client(Google Cloud 服務身分，無金鑰) ─────────────────────────
// 用 Application Default Credentials：在 Cloud Functions 上是函式的執行服務帳戶(透過中繼資料伺服器取得短期權杖)，
// 本機測試則是 `gcloud auth application-default login` 的使用者。程式碼與設定中不會出現任何金鑰。
export async function createSheetsClient(spreadsheetId, { authClient } = {}) {
  if (!spreadsheetId) throw new SyncError('CONFIG', '未設定 AI_EXPORT_SHEET_ID')
  const client = authClient || await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] }).getClient()
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`

  async function call(method, path, { query, data } = {}) {
    const qs = query ? `?${query}` : ''
    let lastErr
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await client.request({ url: `${base}${path}${qs}`, method, data })
        return res.data
      } catch (e) {
        lastErr = e
        const status = e?.response?.status || e?.status || e?.code
        const retryable = status === 429 || (typeof status === 'number' && status >= 500)
        if (!retryable || attempt === 2) break
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
      }
    }
    const status = lastErr?.response?.status || lastErr?.status || ''
    throw new SyncError('SHEETS_API', `Sheets API 失敗${status ? ` (HTTP ${status})` : ''}：${lastErr?.response?.data?.error?.message || lastErr?.message || ''}`, lastErr)
  }

  const enc = encodeURIComponent
  return {
    async getSheets() {
      const d = await call('GET', '', { query: 'fields=sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))' })
      return (d.sheets || []).map((s) => ({
        sheetId: s.properties.sheetId, title: s.properties.title,
        rowCount: s.properties.gridProperties?.rowCount ?? 0, columnCount: s.properties.gridProperties?.columnCount ?? 0,
      }))
    },
    async addTabs(titles) {
      await call('POST', ':batchUpdate', { data: { requests: titles.map((title) => ({ addSheet: { properties: { title } } })) } })
    },
    async resizeSheets(list) {
      await call('POST', ':batchUpdate', {
        data: {
          requests: list.map((s) => ({
            updateSheetProperties: {
              properties: { sheetId: s.sheetId, gridProperties: { rowCount: s.rowCount, columnCount: s.columnCount } },
              fields: 'gridProperties.rowCount,gridProperties.columnCount',
            },
          })),
        },
      })
    },
    async getValues(range) {
      const d = await call('GET', `/values/${enc(range)}`, { query: 'valueRenderOption=UNFORMATTED_VALUE' })
      return d.values || []
    },
    async batchGetValues(ranges) {
      const q = `valueRenderOption=UNFORMATTED_VALUE&${ranges.map((r) => `ranges=${enc(r)}`).join('&')}`
      const d = await call('GET', '/values:batchGet', { query: q })
      return (d.valueRanges || []).map((v) => v.values || [])
    },
    async batchClear(ranges) {
      await call('POST', '/values:batchClear', { data: { ranges } })
    },
    async batchUpdate(data) {
      await call('POST', '/values:batchUpdate', {
        data: { valueInputOption: 'RAW', data: data.map((d) => ({ range: d.range, majorDimension: 'ROWS', values: d.values })) },
      })
    },
  }
}

