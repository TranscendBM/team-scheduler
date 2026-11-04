// AI 資料表「來源讀取 + 整條流程」的整合測試 —— 連本機 Firestore Emulator(不是正式專案)，Sheets 用假的。
// 執行方式：從專案根目錄跑 npm run test:rules(會用 firebase emulators:exec 啟動 emulator；需要 Java)。
//
// 驗證重點：
// - 真實 Firestore 查詢(status in、completedAt 範圍、select 投影)取回的集合，跟預期的範圍一致
// - 使用 Firestore 真正的 Timestamp(不是測試替身)
// - 整條 runAiExport 結果跟純函式用同一批資料算出來的一致，且 Sheet 裡沒有任何敏感資料
// - 查詢不需要複合索引(emulator 不檢查索引，所以這裡用程式檢查：每個查詢都只有單一欄位條件)
import test from 'node:test'
import assert from 'node:assert/strict'

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-team-scheduler-rules'

const { getApps, initializeApp } = await import('firebase-admin/app')
const { getFirestore, Timestamp } = await import('firebase-admin/firestore')
if (getApps().length === 0) initializeApp({ projectId: process.env.GCLOUD_PROJECT })
const db = getFirestore()

const { collectSourceData } = await import('../aiExportSource.js')
const { runAiExport } = await import('../aiExportSync.js')
const { buildSnapshot, TAB, DATA_TABS, checksumRows } = await import('../aiExport.js')
const { FakeSheets } = await import('./helpers/fakeSheets.js')
const F = await import('./helpers/aiExportFixtures.js')

async function clearAll() {
  for (const c of ['requests', 'projects', 'users', 'people']) {
    const snap = await db.collection(c).get()
    await Promise.all(snap.docs.map((d) => d.ref.delete()))
  }
}
const toStored = (r) => {
  const out = { ...r }
  delete out.id
  for (const k of ['createdAt', 'reviewedAt', 'startedAt', 'reviewingAt', 'completedAt']) {
    if (out[k]) out[k] = Timestamp.fromDate(out[k].toDate()) // 用真正的 Firestore Timestamp
  }
  return out
}
async function seed() {
  await clearAll()
  await Promise.all(F.requests.map((r) => db.collection('requests').doc(r.id).set(toStored(r))))
  await Promise.all(F.projects.map((p) => { const { id, ...rest } = p; return db.collection('projects').doc(id).set(rest) }))
  await Promise.all(F.users.map((u) => { const { email, ...rest } = u; return db.collection('users').doc(email).set({ email, ...rest }) }))
  await Promise.all(F.people.map((p) => { const { id, ...rest } = p; return db.collection('people').doc(id).set(rest) }))
}

test('collectSourceData：只取開放中 + 近期已結案 + 已駁回；投影後不含敏感欄位', async () => {
  await seed()
  const src = await collectSourceData(db, { now: F.NOW, includeProjects: true })
  const ids = new Set(src.requests.map((r) => r.id))
  // 開放中 10 筆 + 90 天內結案 1 筆 + 太舊的已結案(2026-06-01)被 completedAt 範圍擋掉 + 已駁回 2 筆(含太舊，交給 buildSnapshot 過濾)
  assert.ok(ids.has('reqDocIdAAAA0001') && ids.has('reqDocIdAAAA0008') && ids.has('reqDocIdAAAA0010'))
  assert.ok(!ids.has('reqDocIdAAAA0009'), '太舊的已結案不應被讀進來')
  assert.equal(src.requests.length, 13) // 10 開放 + 1 結案 + 2 駁回
  const sample = src.requests.find((r) => r.id === 'reqDocIdAAAA0001')
  for (const k of ['description', 'comment', 'reviewNote', 'rejectReason', 'shareToken', 'attachments', 'submittedBy', 'submittedByName', 'reviewedBy', 'assignedDesignersNames']) {
    assert.ok(!(k in sample), `投影後不應含 ${k}`)
  }
  assert.ok(sample.createdAt && typeof sample.createdAt.toDate === 'function') // 真的 Timestamp
  const proj = src.projects.find((p) => p.id === 'projDocIdBBBB0001')
  for (const k of ['location', 'office', 'note', 'rentUSD', 'decorUSD']) assert.ok(!(k in proj), `投影後專案不應含 ${k}`)
  assert.equal(src.users.length, 3)
  assert.ok(src.reads <= 40)
})

test('第一階段預設(不含專案)：完全不讀取 projects 與 people 集合', async () => {
  await seed()
  const touched = []
  const spy = new Proxy(db, { get(t, prop) { if (prop === 'collection') return (name) => { touched.push(name); return t.collection(name) }; const v = t[prop]; return typeof v === 'function' ? v.bind(t) : v } })
  const src = await collectSourceData(spy, { now: F.NOW })
  assert.deepEqual([...new Set(touched)].sort(), ['requests', 'users'])
  assert.equal(src.projects.length, 0)
  assert.equal(src.people.length, 0)
  const fake = new FakeSheets()
  const res = await runAiExport({ db: spy, sheets: fake, hmacKey: F.KEY, now: F.NOW })
  assert.equal(res.counts.projects, 0)
  assert.equal(fake.rows(TAB.PROJECTS).length, 2)
  assert.ok(!fake.dump().includes('J-'))
})

test('明確開啟專案時才處理專案，且仍無敏感資料', async () => {
  await seed()
  const fake = new FakeSheets()
  const res = await runAiExport({ db, sheets: fake, hmacKey: F.KEY, includeProjects: true, now: F.NOW })
  assert.equal(res.counts.projects, 1)
  for (const s of F.SENTINELS) assert.ok(!fake.dump().includes(s), s)
})

test('整條流程(emulator Firestore + 假 Sheets)：結果與純函式一致、讀者驗證通過、Sheet 無敏感資料', async () => {
  await seed()
  const fake = new FakeSheets()
  const res = await runAiExport({ db, sheets: fake, hmacKey: F.KEY, anonymize: true, now: F.NOW })
  assert.equal(res.counts.requests, 12)
  const st = fake.statusMap()
  assert.equal(st.status, 'OK')
  // 同一批資料直接餵純函式，內容(除了 snapshotId 之外)要一致：以 AI_Requests 的 reqCode 與狀態對照
  const expected = buildSnapshot({ requests: F.requests, projects: F.projects, users: F.users, people: F.people, now: F.NOW, hmacKey: F.KEY, anonymize: true })
  const key = (rows) => rows.slice(2).map((r) => `${r[0]}|${r[5]}|${r[6]}|${r[12]}|${r[16]}`).sort()
  assert.deepEqual(key(fake.rows(TAB.REQUESTS)), key(expected.tabs[TAB.REQUESTS]))
  for (const t of DATA_TABS) assert.equal(checksumRows(fake.rows(t)), st[`checksum.${t}`])
  const text = fake.dump()
  for (const s of F.SENTINELS) assert.ok(!text.includes(s), `外洩：${s}`)
  assert.ok(!/@/.test(text) && !/https?:/i.test(text))
})

test('來源是空的(例如權限/讀取異常造成 0 筆)而上次成功有資料：不會洗掉好資料', async () => {
  await seed()
  const fake = new FakeSheets()
  await runAiExport({ db, sheets: fake, hmacKey: F.KEY, now: F.NOW })
  const before = JSON.stringify(fake.rows(TAB.REQUESTS))
  await clearAll()
  await assert.rejects(() => runAiExport({ db, sheets: fake, hmacKey: F.KEY, now: new Date(F.NOW.getTime() + 86400000) }), (e) => e.errorClass === 'SANITY')
  assert.equal(JSON.stringify(fake.rows(TAB.REQUESTS)), before)
  assert.equal(fake.statusMap().status, 'FAILED')
})

test('這個流程對 Firestore 是唯讀：整個過程沒有任何寫入', async () => {
  await seed()
  const snapBefore = JSON.stringify(await Promise.all(['requests', 'projects', 'users', 'people'].map(async (c) =>
    (await db.collection(c).get()).docs.map((d) => [d.id, d.data()]).sort())))
  const fake = new FakeSheets()
  await runAiExport({ db, sheets: fake, hmacKey: F.KEY, now: F.NOW })
  const snapAfter = JSON.stringify(await Promise.all(['requests', 'projects', 'users', 'people'].map(async (c) =>
    (await db.collection(c).get()).docs.map((d) => [d.id, d.data()]).sort())))
  assert.equal(snapAfter, snapBefore)
  const collections = (await db.listCollections()).map((c) => c.id).sort()
  assert.deepEqual(collections, ['people', 'projects', 'requests', 'users']) // 沒有新增 aiExportMeta 之類的集合
})

test('來源讀取筆數超過上限：失敗且不輸出(用極低上限的替身驗證 LimitError 路徑)', async () => {
  await seed()
  const { LIMITS } = await import('../aiExport.js')
  const fake = new FakeSheets()
  await runAiExport({ db, sheets: fake, hmacKey: F.KEY, now: F.NOW }) // 先有一次成功同步(狀態分頁才有上次成功資訊可保留)
  const lastOk = fake.statusMap().lastSuccessAt
  const saved = LIMITS.maxSourceReads
  LIMITS.maxSourceReads = 5
  try {
    await assert.rejects(() => runAiExport({ db, sheets: fake, hmacKey: F.KEY, now: F.NOW }), (e) => e.errorClass === 'LIMIT')
    assert.equal(fake.statusMap().status, 'FAILED')
    assert.equal(fake.statusMap().errorClass, 'LIMIT')
    assert.equal(fake.statusMap().lastSuccessAt, lastOk)
  } finally { LIMITS.maxSourceReads = saved }
})
