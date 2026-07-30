// resolveActivePlannerCcEmails 的整合測試 —— 連本機 Firestore Emulator(不是正式專案)。
// 執行方式：從專案根目錄跑 npm run test:rules（會用 `firebase emulators:exec` 啟動 emulator 後再跑本檔）。
//
// 為什麼要打真的 Firestore：這個函式的核心價值就是「對每個 email 各查一次 users 文件、
// 只留下存在/角色是 planner/啟用中的帳號」，這件事 mock 掉 Firestore 沒有意義，
// 一定要驗證真的查得到、查不到、角色不符、停用時的行為都正確。
//
// 跟 renameUserLogin.test.js 一樣：不需要另外啟動 Functions emulator，因為
// resolveActivePlannerCcEmails 本身不綁 onCall/onDocumentUpdated，直接呼叫即可。
import test from 'node:test'
import assert from 'node:assert/strict'

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-team-scheduler-rules'

const { getFirestore } = await import('firebase-admin/firestore')
const { resolveActivePlannerCcEmails } = await import('../index.js')

const db = getFirestore()

async function clearUsers() {
  const snap = await db.collection('users').get()
  await Promise.all(snap.docs.map((d) => d.ref.delete()))
}

async function seedUser(email, overrides = {}) {
  await db.collection('users').doc(email).set({ email, role: 'planner', active: true, ...overrides })
}

test.beforeEach(clearUsers)

test('合法啟用的 planner 會被加入 CC', async () => {
  await seedUser('planner.a@example.com')
  const result = await resolveActivePlannerCcEmails(['planner.a@example.com'])
  assert.deepEqual(result, ['planner.a@example.com'])
})

test('用 notifyEmail(若有設定)取代登入 email', async () => {
  await seedUser('planner.b@example.com', { notifyEmail: 'planner-b-company@transcend-info.com' })
  const result = await resolveActivePlannerCcEmails(['planner.b@example.com'])
  assert.deepEqual(result, ['planner-b-company@transcend-info.com'])
})

test('重複的 planner email 會被去重', async () => {
  await seedUser('planner.c@example.com')
  const result = await resolveActivePlannerCcEmails(['planner.c@example.com', 'Planner.C@example.com', 'planner.c@example.com'])
  assert.deepEqual(result, ['planner.c@example.com'])
})

test('不存在的 email 會被排除', async () => {
  const result = await resolveActivePlannerCcEmails(['nobody@example.com'])
  assert.deepEqual(result, [])
})

test('角色是 designer 的帳號會被排除', async () => {
  await seedUser('designer.x@example.com', { role: 'designer' })
  const result = await resolveActivePlannerCcEmails(['designer.x@example.com'])
  assert.deepEqual(result, [])
})

test('角色是 manager 的帳號會被排除', async () => {
  await seedUser('manager.x@example.com', { role: 'manager' })
  const result = await resolveActivePlannerCcEmails(['manager.x@example.com'])
  assert.deepEqual(result, [])
})

test('active:false 的帳號會被排除', async () => {
  await seedUser('planner.deactivated@example.com', { active: false })
  const result = await resolveActivePlannerCcEmails(['planner.deactivated@example.com'])
  assert.deepEqual(result, [])
})

test('非字串元素會被排除，不會讓查詢炸掉', async () => {
  await seedUser('planner.d@example.com')
  const result = await resolveActivePlannerCcEmails(['planner.d@example.com', 12345, null, {}, ['x']])
  assert.deepEqual(result, ['planner.d@example.com'])
})

test('不是陣列(例如舊資料或攻擊輸入)一律回傳空陣列', async () => {
  assert.deepEqual(await resolveActivePlannerCcEmails('not-a-list'), [])
  assert.deepEqual(await resolveActivePlannerCcEmails(undefined), [])
  assert.deepEqual(await resolveActivePlannerCcEmails(null), [])
})

test('超過 10 筆上限只取前 10 筆(去重後)，行為明確一致，不會查超過上限的筆數', async () => {
  const emails = Array.from({ length: 15 }, (_, i) => `planner${i}@example.com`)
  await Promise.all(emails.map((e) => seedUser(e)))
  const result = await resolveActivePlannerCcEmails(emails)
  assert.equal(result.length, 10)
  assert.deepEqual(result, emails.slice(0, 10))
})

test('混合合法/不存在/停用/非字串：只留下真正合法的啟用 planner', async () => {
  await seedUser('planner.ok1@example.com')
  await seedUser('planner.ok2@example.com')
  await seedUser('planner.off@example.com', { active: false })
  await seedUser('designer.no@example.com', { role: 'designer' })
  const result = await resolveActivePlannerCcEmails([
    'planner.ok1@example.com', 'nonexistent@example.com', 'planner.off@example.com',
    'designer.no@example.com', 123, 'planner.ok2@example.com',
  ])
  assert.deepEqual(result.sort(), ['planner.ok1@example.com', 'planner.ok2@example.com'])
})
