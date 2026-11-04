// AI 資料表「寫入 Google Sheets」流程測試：用假的 Sheets client 驗證 commit-marker、失敗保護、合理性檢查。
// 重點是「任何失敗情境下，讀的人都不會把舊資料或半套資料當成最新」。不連任何 Firebase/Google 服務。
import test from 'node:test'
import assert from 'node:assert/strict'
import { syncToSheet, runAiExport, SyncError, parseStatusRows, buildStatusRows } from '../aiExportSync.js'
import { buildSnapshot, TAB, DATA_TABS, checksumRows, canonRows } from '../aiExport.js'
import { FakeSheets } from './helpers/fakeSheets.js'
import { KEY, NOW, SENTINELS, users, people, requests, projects } from './helpers/aiExportFixtures.js'

const snapOf = (reqs, now = NOW) => buildSnapshot({ requests: reqs, projects, users, people, now, hmacKey: KEY, anonymize: true })
const LATER = new Date(NOW.getTime() + 24 * 3600 * 1000)

// 讀者(ChatGPT)的信任規則：status=OK，且每個資料分頁 #META 的 snapshotId 與狀態一致、內容 checksum 與狀態一致
function readerTrusts(fake) {
  const st = fake.statusMap()
  if (st.status !== 'OK' || st.dataTrusted !== true) return false
  for (const t of DATA_TABS) {
    const rows = canonRows(fake.rows(t))
    if (!rows[0] || rows[0][0] !== '#META' || rows[0][1] !== `snapshotId=${st.snapshotId}`) return false
    if (checksumRows(fake.rows(t)) !== st[`checksum.${t}`]) return false
  }
  return true
}

test('首次同步：建立分頁、擴充格子、寫入資料，狀態為 OK 且讀者驗證通過', async () => {
  const fake = new FakeSheets()
  const snap = snapOf(requests)
  const res = await syncToSheet({ sheets: fake, snapshot: snap, now: NOW })
  assert.equal(res.snapshotId, snap.snapshotId)
  for (const t of [...DATA_TABS, TAB.STATUS]) assert.ok(fake.tabs.has(t), `缺少分頁 ${t}`)
  const st = fake.statusMap()
  assert.equal(st.status, 'OK')
  assert.equal(st.dataTrusted, true)
  assert.equal(st.snapshotId, snap.snapshotId)
  assert.equal(st.lastSuccessAt, NOW.toISOString())
  assert.equal(st.lastSuccessSnapshotId, snap.snapshotId)
  assert.equal(st.requestsInScope, 12)
  assert.equal(st.schemaVersion, '1.0.0')
  assert.ok(readerTrusts(fake))
})

test('寫入順序：先 UPDATING、再寫資料、最後才 OK(commit marker)', async () => {
  const fake = new FakeSheets()
  await syncToSheet({ sheets: fake, snapshot: snapOf(requests), now: NOW })
  const writes = fake.calls.filter((c) => c.method === 'batchUpdate')
  assert.deepEqual(writes.map((w) => w.status ?? 'DATA'), ['UPDATING', 'DATA', 'OK'])
  // 讀回驗證發生在 OK 之前
  const idxVerify = fake.calls.findIndex((c) => c.method === 'batchGetValues')
  const idxOk = fake.calls.findIndex((c) => c.method === 'batchUpdate' && c.status === 'OK')
  assert.ok(idxVerify > -1 && idxVerify < idxOk)
})

test('第二次同步：列數變少時沒有殘留的舊列，且更新 snapshotId / lastSuccessAt', async () => {
  const fake = new FakeSheets()
  await syncToSheet({ sheets: fake, snapshot: snapOf(requests), now: NOW })
  const small = snapOf(requests.slice(0, 8), LATER)
  await syncToSheet({ sheets: fake, snapshot: small, now: LATER })
  const rows = canonRows(fake.rows(TAB.REQUESTS))
  assert.equal(rows.length, 2 + small.counts.requests) // #META + 表頭 + 資料
  assert.equal(fake.statusMap().snapshotId, small.snapshotId)
  assert.equal(fake.statusMap().lastSuccessAt, LATER.toISOString())
  assert.ok(readerTrusts(fake))
})

test('寫入資料時失敗：狀態是 FAILED、不可信，lastSuccessAt 與上次成功的筆數保持舊值(不會標成最新)', async () => {
  const fake = new FakeSheets()
  await syncToSheet({ sheets: fake, snapshot: snapOf(requests), now: NOW })
  const before = fake.statusMap()
  fake.failOn('batchUpdate', { when: (args) => args[0].range.startsWith(TAB.README) })
  await assert.rejects(() => syncToSheet({ sheets: fake, snapshot: snapOf(requests, LATER), now: LATER }), SyncError)
  const st = fake.statusMap()
  assert.equal(st.status, 'FAILED')
  assert.equal(st.dataTrusted, false)
  assert.equal(st.lastSuccessAt, before.lastSuccessAt)
  assert.equal(st.lastSuccessSnapshotId, before.lastSuccessSnapshotId)
  assert.equal(st.requestsInScope, 12)
  assert.equal(st.errorClass, 'SHEETS_API')
  assert.ok(!readerTrusts(fake))
})

test('讀回內容與預期不一致(例如少了一列)：視為失敗，不會標成 OK', async () => {
  const fake = new FakeSheets()
  fake.afterBatchUpdate = (f, data) => {
    if (data.some((d) => d.range.startsWith(TAB.REQUESTS))) f.tabs.get(TAB.REQUESTS).rows.pop()
  }
  await assert.rejects(() => syncToSheet({ sheets: fake, snapshot: snapOf(requests), now: NOW }), (e) => e.errorClass === 'VERIFY_MISMATCH')
  assert.equal(fake.statusMap().status, 'FAILED')
  assert.equal(fake.statusMap().errorClass, 'VERIFY_MISMATCH')
  assert.ok(!readerTrusts(fake))
})

test('讀回時發現舊列殘留(清除沒生效)：checksum 不符，視為失敗', async () => {
  const fake = new FakeSheets()
  const origClear = fake.batchClear.bind(fake)
  fake.batchClear = async (ranges) => { fake.calls.push({ method: 'batchClear' }) ; void origClear; /* 故意不清 */ }
  await syncToSheet({ sheets: fake, snapshot: snapOf(requests), now: NOW }) // 第一次沒有舊資料，會成功
  const small = snapOf(requests.slice(0, 8), LATER)
  fake.afterBatchUpdate = (f) => { // 模擬 Sheets 沒把舊的最後幾列覆蓋掉
    const t = f.tabs.get(TAB.REQUESTS); t.rows.push(['STALE-ROW', 'x'])
  }
  await assert.rejects(() => syncToSheet({ sheets: fake, snapshot: small, now: LATER }), (e) => e.errorClass === 'VERIFY_MISMATCH')
  assert.ok(!readerTrusts(fake))
})

test('最後寫 OK 狀態失敗：資料雖然已寫入，但狀態不會是 OK', async () => {
  const fake = new FakeSheets()
  await syncToSheet({ sheets: fake, snapshot: snapOf(requests), now: NOW })
  const before = fake.statusMap()
  fake.failOn('batchUpdate', { when: (args) => args.length === 1 && args[0].range.startsWith(TAB.STATUS) && args[0].values.some((r) => r[0] === 'status' && r[1] === 'OK') })
  await assert.rejects(() => syncToSheet({ sheets: fake, snapshot: snapOf(requests, LATER), now: LATER }))
  const st = fake.statusMap()
  assert.notEqual(st.status, 'OK')
  assert.equal(st.dataTrusted, false)
  assert.equal(st.lastSuccessAt, before.lastSuccessAt)
  assert.ok(!readerTrusts(fake))
})

test('連「失敗」狀態都寫不進去(Sheets 整個壞掉)：狀態停在 UPDATING，仍是不可信，且保留舊的 lastSuccessAt', async () => {
  const fake = new FakeSheets()
  await syncToSheet({ sheets: fake, snapshot: snapOf(requests), now: NOW })
  const before = fake.statusMap()
  let n = 0
  fake.failOn('batchUpdate', { when: () => ++n > 1 }) // 只有第一次(UPDATING)寫得進去
  await assert.rejects(() => syncToSheet({ sheets: fake, snapshot: snapOf(requests, LATER), now: LATER }))
  const st = fake.statusMap()
  assert.equal(st.status, 'UPDATING')
  assert.equal(st.dataTrusted, false)
  assert.equal(st.lastSuccessAt, before.lastSuccessAt)
  assert.ok(!readerTrusts(fake))
})

test('讀者能辨認「各分頁版本不一致」：只有一個分頁被換成新 snapshotId 時，驗證不通過', async () => {
  const fake = new FakeSheets()
  await syncToSheet({ sheets: fake, snapshot: snapOf(requests), now: NOW })
  assert.ok(readerTrusts(fake))
  const other = snapOf(requests, LATER)
  fake.tabs.get(TAB.SUMMARY).rows = other.tabs[TAB.SUMMARY].map((r) => [...r]) // 模擬只更新了一個分頁
  assert.ok(!readerTrusts(fake))
})

test('合理性檢查：來源突然 0 筆 → 拒絕寫入、標 FAILED、資料分頁完全不動', async () => {
  const fake = new FakeSheets()
  await syncToSheet({ sheets: fake, snapshot: snapOf(requests), now: NOW })
  const before = JSON.stringify(fake.rows(TAB.REQUESTS))
  await assert.rejects(() => syncToSheet({ sheets: fake, snapshot: snapOf([], LATER), now: LATER }), (e) => e.errorClass === 'SANITY')
  assert.equal(JSON.stringify(fake.rows(TAB.REQUESTS)), before)
  assert.equal(fake.statusMap().status, 'FAILED')
  assert.equal(fake.statusMap().errorClass, 'SANITY')
  assert.equal(fake.statusMap().lastSuccessAt, NOW.toISOString())
})

test('合理性檢查：筆數驟降超過 50%(上次 ≥ 10 筆) → 拒絕；少量資料(上次 < 10 筆)不套用', async () => {
  const fake = new FakeSheets()
  await syncToSheet({ sheets: fake, snapshot: snapOf(requests), now: NOW }) // 12 筆
  await assert.rejects(() => syncToSheet({ sheets: fake, snapshot: snapOf(requests.slice(0, 5), LATER), now: LATER }), (e) => e.errorClass === 'SANITY')
  const fake2 = new FakeSheets()
  await syncToSheet({ sheets: fake2, snapshot: snapOf(requests.slice(0, 4)), now: NOW })
  await syncToSheet({ sheets: fake2, snapshot: snapOf(requests.slice(0, 1), LATER), now: LATER }) // 4 → 1 但上次不到 10 筆
  assert.equal(fake2.statusMap().status, 'OK')
})

test('Sheets 暫時不可用(讀分頁清單失敗)：標 FAILED，資料分頁維持原狀', async () => {
  const fake = new FakeSheets()
  await syncToSheet({ sheets: fake, snapshot: snapOf(requests), now: NOW })
  const before = JSON.stringify(fake.rows(TAB.REQUESTS))
  fake.failOn('getSheets', { nth: 1 })
  fake._count.getSheets = 0
  await assert.rejects(() => syncToSheet({ sheets: fake, snapshot: snapOf(requests, LATER), now: LATER }))
  assert.equal(fake.statusMap().status, 'FAILED')
  assert.equal(JSON.stringify(fake.rows(TAB.REQUESTS)), before)
  assert.ok(!readerTrusts(fake))
})

test('資料量大時自動擴充格子，不會因超出預設 1000 列而寫入失敗', async () => {
  const many = Array.from({ length: 2500 }, (_, i) => ({ id: `big-${i}`, status: 'assigned', dueDate: '2026-12-01', docTypes: ['Banner'], region: 'US', assignedDesigners: ['d1@example.com'] }))
  const fake = new FakeSheets()
  await syncToSheet({ sheets: fake, snapshot: snapOf(many), now: NOW })
  assert.ok(fake.tabs.get(TAB.REQUESTS).rowCount >= 2502)
  assert.ok(readerTrusts(fake))
})

test('錯誤訊息裡若含 email，寫進狀態分頁前會被遮蔽；狀態分頁固定大小，不殘留舊 key', async () => {
  const fake = new FakeSheets()
  await syncToSheet({ sheets: fake, snapshot: snapOf(requests), now: NOW })
  fake.failOn('batchClear', { error: new Error('forbidden for someone@example.com\nsecond line') })
  await assert.rejects(() => syncToSheet({ sheets: fake, snapshot: snapOf(requests, LATER), now: LATER }))
  const note = String(fake.statusMap().errorNote)
  assert.ok(!note.includes('someone@example.com') && !note.includes('\n'))
  assert.ok(note.includes('[email]'))
  assert.equal(fake.rows(TAB.STATUS).length, 40)
})

test('Sheets 內容全部檢查：沒有任何敏感哨兵字串、email、網址', async () => {
  const fake = new FakeSheets()
  await syncToSheet({ sheets: fake, snapshot: snapOf(requests), now: NOW })
  const text = fake.dump()
  for (const s of SENTINELS) assert.ok(!text.includes(s), `外洩：${s}`)
  assert.ok(!/@/.test(text))
  assert.ok(!/https?:/i.test(text))
})

test('runAiExport：來源讀取失敗 → 狀態標 FAILED(SOURCE)、資料分頁不動、錯誤往外丟', async () => {
  const fake = new FakeSheets()
  await syncToSheet({ sheets: fake, snapshot: snapOf(requests), now: NOW })
  const before = JSON.stringify(fake.rows(TAB.REQUESTS))
  const brokenDb = { collection() { throw new Error('PERMISSION_DENIED: Missing or insufficient permissions') } }
  await assert.rejects(() => runAiExport({ db: brokenDb, sheets: fake, hmacKey: KEY, now: LATER }), (e) => e instanceof SyncError && e.errorClass === 'SOURCE')
  assert.equal(fake.statusMap().status, 'FAILED')
  assert.equal(fake.statusMap().errorClass, 'SOURCE')
  assert.equal(JSON.stringify(fake.rows(TAB.REQUESTS)), before)
  assert.equal(fake.statusMap().lastSuccessAt, NOW.toISOString())
})

test('runAiExport：HMAC 密鑰缺少 → 失敗且不輸出任何資料(不會用空密鑰產生代號)', async () => {
  const fake = new FakeSheets()
  const emptyDb = { collection: () => ({ where: () => ({ select: () => ({ limit: () => ({ get: async () => ({ size: 0, docs: [] }) }) }) }), select: () => ({ limit: () => ({ get: async () => ({ size: 0, docs: [] }) }) }) }) }
  await assert.rejects(() => runAiExport({ db: emptyDb, sheets: fake, hmacKey: '', now: NOW }))
  assert.ok(!readerTrusts(fake))
})

test('狀態分頁序列化/解析互通', () => {
  const rows = buildStatusRows({ status: 'OK', trusted: true, snapshotId: 'S1', anonymize: true, attemptAt: 'T', successAt: 'T', successSnapshotId: 'S1', counts: { requests: 7, projects: 3 }, rows: {}, checksums: {} })
  assert.equal(rows.length, 40)
  assert.deepEqual(parseStatusRows(rows), { status: 'OK', lastSuccessAt: 'T', lastSuccessSnapshotId: 'S1', requestsInScope: 7, projectsExported: 3 })
})

test('Sheet 上各分頁 #META 的 dataRows 與 AI_Sync_Status 的 rows.<分頁> 完全相同', async () => {
  const fake = new FakeSheets()
  await syncToSheet({ sheets: fake, snapshot: snapOf(requests), now: NOW })
  const st = fake.statusMap()
  for (const t of DATA_TABS) {
    const meta = fake.rows(t)[0]
    assert.equal(meta[4], `dataRows=${st[`rows.${t}`]}`, t)
  }
  assert.equal(st[`rows.${TAB.REQUESTS}`], 12)
  assert.equal(fake.rows(TAB.REQUESTS).length - 2, st[`rows.${TAB.REQUESTS}`])
})
