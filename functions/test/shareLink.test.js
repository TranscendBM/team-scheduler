// createShareLinkCore / revokeShareLinkCore / getSharedRequestCore 的整合測試 —— 連本機
// Firestore Emulator(不是正式專案)。執行方式：從專案根目錄跑 npm run test:rules。
//
// 為什麼不是純函式測試：這三個函式的核心價值就是「對照 Firestore 裡實際的 users/requests/
// settings 文件做身分/token 判斷」，這件事沒辦法用 mock 掉 Firestore 的方式充分驗證。
//
// 為什麼不需要另外啟動 Functions emulator：三個 *Core 函式都是抽出來、不綁 onCall 的純邏輯
// 函式(db 用參數傳入)，這裡直接呼叫它、餵一個指向 emulator 的 Firestore 實例即可。
import test from 'node:test'
import assert from 'node:assert/strict'

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-team-scheduler-rules'

const { getFirestore, Timestamp } = await import('firebase-admin/firestore')
const { createShareLinkCore, revokeShareLinkCore, getSharedRequestCore } = await import('../index.js')

const db = getFirestore()

const MANAGER = 'manager@example.com'
const SUBMITTER = 'submitter@example.com'
const DESIGNER = 'designer@example.com'
const REGION_PLANNER = 'region-planner@example.com'
const OUTSIDER = 'outsider@example.com' // 白名單內、啟用中，但跟這筆需求毫無關聯的組員
const DEACTIVATED = 'deactivated@example.com'
const NOT_WHITELISTED = 'not-whitelisted@example.com' // 從未寫進 users collection

const REQUEST_ID = 'r1'

async function clearAll() {
  for (const col of ['users', 'requests', 'settings']) {
    const snap = await db.collection(col).get()
    await Promise.all(snap.docs.map((d) => d.ref.delete()))
  }
}

async function seedUsers() {
  await db.collection('users').doc(MANAGER).set({ email: MANAGER, role: 'manager', active: true })
  await db.collection('users').doc(SUBMITTER).set({ email: SUBMITTER, role: 'planner', active: true, regions: ['SD1'] })
  await db.collection('users').doc(DESIGNER).set({ email: DESIGNER, role: 'designer', active: true })
  await db.collection('users').doc(REGION_PLANNER).set({ email: REGION_PLANNER, role: 'planner', active: true, regions: ['SD1'] })
  await db.collection('users').doc(OUTSIDER).set({ email: OUTSIDER, role: 'planner', active: true, regions: ['SD2'] })
  await db.collection('users').doc(DEACTIVATED).set({ email: DEACTIVATED, role: 'planner', active: false, regions: ['SD1'] })
}

async function seedRequest(overrides = {}) {
  await db.collection('requests').doc(REQUEST_ID).set({
    submittedBy: SUBMITTER, region: 'SD1', status: 'pending', projectName: 'x',
    assignedDesigners: [DESIGNER], ...overrides,
  })
}

test.beforeEach(async () => {
  await clearAll()
  await seedUsers()
  await seedRequest()
})

// ── createShareLinkCore ──────────────────────────────────────────────
test('createShareLinkCore：未登入(空字串 email)被拒絕(unauthenticated)', async () => {
  await assert.rejects(
    () => createShareLinkCore(db, '', { requestId: REQUEST_ID }),
    (err) => err.code === 'unauthenticated'
  )
})

test('createShareLinkCore：缺少 requestId 被拒絕(invalid-argument)', async () => {
  await assert.rejects(
    () => createShareLinkCore(db, MANAGER, {}),
    (err) => err.code === 'invalid-argument'
  )
})

test('createShareLinkCore：需求不存在被拒絕(not-found)', async () => {
  await assert.rejects(
    () => createShareLinkCore(db, MANAGER, { requestId: 'does-not-exist' }),
    (err) => err.code === 'not-found'
  )
})

test('createShareLinkCore：跟這筆需求無關的白名單組員被拒絕(permission-denied)', async () => {
  await assert.rejects(
    () => createShareLinkCore(db, OUTSIDER, { requestId: REQUEST_ID }),
    (err) => err.code === 'permission-denied'
  )
})

for (const [label, email] of [
  ['manager', MANAGER],
  ['提交人', SUBMITTER],
  ['被指派的設計師', DESIGNER],
  ['負責地區的 planner', REGION_PLANNER],
]) {
  test(`createShareLinkCore：${label} 可以建立分享連結`, async () => {
    const result = await createShareLinkCore(db, email, { requestId: REQUEST_ID })
    assert.equal(typeof result.shareToken, 'string')
    assert.ok(result.shareToken.length > 0)
    assert.equal(typeof result.shareExpiresAt, 'string')
    const doc = (await db.collection('requests').doc(REQUEST_ID).get()).data()
    assert.equal(doc.shareToken, result.shareToken)
    assert.equal(doc.shareCreatedBy, email)
    assert.ok(doc.shareExpiresAt)
    assert.ok(doc.shareCreatedAt)
  })
}

test('createShareLinkCore：臨時審核代理人在授權區間內可以建立', async () => {
  const now = Date.now()
  await db.collection('settings').doc('reviewDelegation').set({
    loginEmail: OUTSIDER,
    startsAt: Timestamp.fromMillis(now - 60_000),
    expiresAt: Timestamp.fromMillis(now + 60_000),
  })
  const result = await createShareLinkCore(db, OUTSIDER, { requestId: REQUEST_ID })
  assert.equal(typeof result.shareToken, 'string')
})

test('createShareLinkCore：臨時審核代理人授權區間已過期，不可以建立', async () => {
  const now = Date.now()
  await db.collection('settings').doc('reviewDelegation').set({
    loginEmail: OUTSIDER,
    startsAt: Timestamp.fromMillis(now - 120_000),
    expiresAt: Timestamp.fromMillis(now - 60_000),
  })
  await assert.rejects(
    () => createShareLinkCore(db, OUTSIDER, { requestId: REQUEST_ID }),
    (err) => err.code === 'permission-denied'
  )
})

test('createShareLinkCore：重新呼叫會產生全新的 token，舊 token 立刻失效', async () => {
  const first = await createShareLinkCore(db, MANAGER, { requestId: REQUEST_ID })
  const second = await createShareLinkCore(db, MANAGER, { requestId: REQUEST_ID })
  assert.notEqual(first.shareToken, second.shareToken)
  await assert.rejects(
    () => getSharedRequestCore(db, OUTSIDER, { requestId: REQUEST_ID, token: first.shareToken }),
    (err) => err.code === 'not-found'
  )
  const viaNewToken = await getSharedRequestCore(db, OUTSIDER, { requestId: REQUEST_ID, token: second.shareToken })
  assert.equal(viaNewToken.id, REQUEST_ID)
})

// ── revokeShareLinkCore ──────────────────────────────────────────────
test('revokeShareLinkCore：跟這筆需求無關的白名單組員被拒絕(permission-denied)', async () => {
  await createShareLinkCore(db, MANAGER, { requestId: REQUEST_ID })
  await assert.rejects(
    () => revokeShareLinkCore(db, OUTSIDER, { requestId: REQUEST_ID }),
    (err) => err.code === 'permission-denied'
  )
})

test('revokeShareLinkCore：撤銷後，舊 token 無法再透過分享連結取得需求', async () => {
  const { shareToken } = await createShareLinkCore(db, MANAGER, { requestId: REQUEST_ID })
  const revokeResult = await revokeShareLinkCore(db, MANAGER, { requestId: REQUEST_ID })
  assert.equal(revokeResult.revoked, true)
  await assert.rejects(
    () => getSharedRequestCore(db, OUTSIDER, { requestId: REQUEST_ID, token: shareToken }),
    (err) => err.code === 'not-found'
  )
})

test('revokeShareLinkCore：本來就沒有分享連結時，撤銷仍冪等成功、不噴錯', async () => {
  const result = await revokeShareLinkCore(db, MANAGER, { requestId: REQUEST_ID })
  assert.equal(result.revoked, true)
})

// ── getSharedRequestCore ──────────────────────────────────────────────
test('getSharedRequestCore：核心情境——跟需求完全無關的白名單組員，靠分享連結仍能看到內容', async () => {
  const { shareToken } = await createShareLinkCore(db, MANAGER, { requestId: REQUEST_ID })
  const result = await getSharedRequestCore(db, OUTSIDER, { requestId: REQUEST_ID, token: shareToken })
  assert.equal(result.id, REQUEST_ID)
  assert.equal(result.projectName, 'x')
  assert.equal(result.region, 'SD1')
})

test('getSharedRequestCore：未登入(空字串 email)被拒絕(unauthenticated)', async () => {
  const { shareToken } = await createShareLinkCore(db, MANAGER, { requestId: REQUEST_ID })
  await assert.rejects(
    () => getSharedRequestCore(db, '', { requestId: REQUEST_ID, token: shareToken }),
    (err) => err.code === 'unauthenticated'
  )
})

test('getSharedRequestCore：不在白名單內的帳號被拒絕(permission-denied)', async () => {
  const { shareToken } = await createShareLinkCore(db, MANAGER, { requestId: REQUEST_ID })
  await assert.rejects(
    () => getSharedRequestCore(db, NOT_WHITELISTED, { requestId: REQUEST_ID, token: shareToken }),
    (err) => err.code === 'permission-denied'
  )
})

test('getSharedRequestCore：已停用的帳號被拒絕(permission-denied)', async () => {
  const { shareToken } = await createShareLinkCore(db, MANAGER, { requestId: REQUEST_ID })
  await assert.rejects(
    () => getSharedRequestCore(db, DEACTIVATED, { requestId: REQUEST_ID, token: shareToken }),
    (err) => err.code === 'permission-denied'
  )
})

test('getSharedRequestCore：缺少 requestId 或 token 被拒絕(invalid-argument)', async () => {
  await createShareLinkCore(db, MANAGER, { requestId: REQUEST_ID })
  await assert.rejects(
    () => getSharedRequestCore(db, OUTSIDER, { requestId: REQUEST_ID }),
    (err) => err.code === 'invalid-argument'
  )
  await assert.rejects(
    () => getSharedRequestCore(db, OUTSIDER, { token: 'whatever' }),
    (err) => err.code === 'invalid-argument'
  )
})

test('getSharedRequestCore：需求從未有分享連結(shareToken 欄位不存在)被拒絕(not-found)', async () => {
  await assert.rejects(
    () => getSharedRequestCore(db, OUTSIDER, { requestId: REQUEST_ID, token: 'guessed-token' }),
    (err) => err.code === 'not-found'
  )
})

test('getSharedRequestCore：token 錯誤被拒絕(not-found)', async () => {
  await createShareLinkCore(db, MANAGER, { requestId: REQUEST_ID })
  await assert.rejects(
    () => getSharedRequestCore(db, OUTSIDER, { requestId: REQUEST_ID, token: 'wrong-token' }),
    (err) => err.code === 'not-found'
  )
})

test('getSharedRequestCore：token 正確但已過期被拒絕(not-found)', async () => {
  await createShareLinkCore(db, MANAGER, { requestId: REQUEST_ID })
  // 直接把 shareExpiresAt 改成過去，模擬「連結已經過期」而不用真的等 30 天
  await db.collection('requests').doc(REQUEST_ID).update({ shareExpiresAt: Timestamp.fromMillis(Date.now() - 1000) })
  const doc = (await db.collection('requests').doc(REQUEST_ID).get()).data()
  await assert.rejects(
    () => getSharedRequestCore(db, OUTSIDER, { requestId: REQUEST_ID, token: doc.shareToken }),
    (err) => err.code === 'not-found'
  )
})

test('getSharedRequestCore：回傳的內容包含附件、指派名單，且時間戳欄位是 ISO 字串(不是 Timestamp 物件)', async () => {
  await seedRequest({
    attachments: [{ name: 'a.pdf', url: 'https://example.com/a.pdf', size: 1024 }],
    assignedDesignersNames: ['設計師甲'],
    reviewNote: '備註內容',
  })
  const { shareToken } = await createShareLinkCore(db, MANAGER, { requestId: REQUEST_ID })
  const result = await getSharedRequestCore(db, OUTSIDER, { requestId: REQUEST_ID, token: shareToken })
  assert.deepEqual(result.attachments, [{ name: 'a.pdf', url: 'https://example.com/a.pdf', size: 1024 }])
  assert.deepEqual(result.assignedDesignersNames, ['設計師甲'])
  assert.equal(result.reviewNote, '備註內容')
  assert.equal(result.createdAt, null) // 這筆測試資料沒有設 createdAt，應該是 null 不是噴錯
  assert.equal(typeof result.status, 'string')
})
