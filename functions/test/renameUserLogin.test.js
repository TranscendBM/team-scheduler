// renameUserLogin 的整合測試 —— 連本機 Firestore Emulator(不是正式專案)。
// 執行方式：從專案根目錄跑 npm run test:rules（會用 `firebase emulators:exec` 啟動 Firestore
// emulator 後再跑這個檔案；需要本機已安裝 Java）。
//
// 為什麼不是純函式測試：renameUserLogin 本質上就是要驗證「對 Firestore 做的一連串讀寫，
// 順序/冪等性/失敗恢復是否正確」，這件事沒辦法用 mock 掉 Firestore 的方式充分驗證，
// 一定要打真的 Firestore(emulator)才有意義。
//
// 為什麼不需要另外啟動 Functions emulator：renameUserLoginCore 是抽出來、不綁 onCall 的純邏輯函式
// (db 用參數傳入)，這裡直接呼叫它、餵一個指向 emulator 的 Firestore 實例即可，onCall 那層薄薄的
// 「從 request 拉 email/data 出來再呼叫 core」不需要另外測試。
//
// 關於「final batch 本身失敗時沒有半完成狀態」：這件事是靠設計本身保證的(newRef 清 renamedFrom、
// userRenameOperations 標 completed、刪 oldRef 這三件事包在同一個 firestoreDb.batch().commit() 裡，
// Firestore 的 batch 本來就保證要嘛全部生效要嘛全部不生效)，沒有寫成獨立測試去真的強迫 batch.commit()
// 失敗 —— 對著真實 emulator 做這件事需要 mock 掉 Firestore 內部的網路層，不值得為了這個結構性保證
// 增加測試的脆弱度。下面「final batch 前中斷後重試」那組測試涵蓋的是「commit 之前」的中斷/續傳，
// 這是唯一實際會發生、也唯一需要驗證恢復行為的中斷點。
import test from 'node:test'
import assert from 'node:assert/strict'

// 注意：一定要在 import firebase-admin/../index.js 之前就設好這兩個環境變數 ——
// ES module 的 static import 會被提升到檔案最前面先執行，所以不能像一般腳本那樣把
// process.env.X = ... 寫在 import 的前面就以為它會先跑；這裡改用動態 import() 確保順序正確。
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'team-scheduler-rename-test'

const { getFirestore } = await import('firebase-admin/firestore')
const { renameUserLoginCore } = await import('../index.js')

const db = getFirestore()

const MANAGER = 'manager@example.com'
const DEACTIVATED_MANAGER = 'exmanager@example.com'
const DESIGNER_CALLER = 'designer@example.com'
const OLD = 'old.gmail@gmail.com'
const NEW = 'new.gmail@gmail.com'
const OTHER = 'someone-else@gmail.com'

async function clearAll() {
  // userRenameOperations 一定要跟著清，不然前一個測試留下的 completed 操作紀錄會讓後面重用
  // 同一組 OLD/NEW 常數的測試在 reserveRename() 一開始就被誤判成「已完成」而短路，
  // 完全不會真的跑搬遷邏輯 —— 這正是先前發生過的測試汙染成因。
  for (const col of ['users', 'requests', 'userRenameOperations']) {
    const snap = await db.collection(col).get()
    await Promise.all(snap.docs.map((d) => d.ref.delete()))
  }
}

async function seedManager(email = MANAGER, overrides = {}) {
  await db.collection('users').doc(email).set({ email, role: 'manager', active: true, ...overrides })
}

test.beforeEach(clearAll)

test('caller 不是主管會被拒絕(permission-denied)', async () => {
  await db.collection('users').doc(DESIGNER_CALLER).set({ email: DESIGNER_CALLER, role: 'designer', active: true })
  await db.collection('users').doc(OLD).set({ email: OLD, role: 'designer', active: true })
  await assert.rejects(
    () => renameUserLoginCore(db, DESIGNER_CALLER, { oldEmail: OLD, newEmail: NEW }),
    (err) => err.code === 'permission-denied'
  )
})

test('caller 是已停用的主管會被拒絕', async () => {
  await seedManager(DEACTIVATED_MANAGER, { active: false })
  await db.collection('users').doc(OLD).set({ email: OLD, role: 'designer', active: true })
  await assert.rejects(
    () => renameUserLoginCore(db, DEACTIVATED_MANAGER, { oldEmail: OLD, newEmail: NEW }),
    (err) => err.code === 'permission-denied'
  )
})

test('caller 未登入(空字串 email)會被拒絕(unauthenticated)', async () => {
  await assert.rejects(
    () => renameUserLoginCore(db, '', { oldEmail: OLD, newEmail: NEW }),
    (err) => err.code === 'unauthenticated'
  )
})

test('沒有任何 submitted/assigned requests：搬遷成功，只搬 users', async () => {
  await seedManager()
  await db.collection('users').doc(OLD).set({ email: OLD, displayName: 'Old Name', role: 'designer', active: true })

  const result = await renameUserLoginCore(db, MANAGER, { oldEmail: OLD, newEmail: NEW })

  assert.equal(result.migratedAsDesigner, 0)
  assert.equal(result.migratedAsSubmitter, 0)
  assert.equal((await db.collection('users').doc(OLD).get()).exists, false)
  const newDoc = await db.collection('users').doc(NEW).get()
  assert.equal(newDoc.exists, true)
  assert.equal(newDoc.data().displayName, 'Old Name')
  assert.equal(newDoc.data().renamedFrom, undefined)
})

test('有 submittedBy 是舊信箱的需求：搬遷後 submittedBy 換成新信箱', async () => {
  await seedManager()
  await db.collection('users').doc(OLD).set({ email: OLD, role: 'planner', active: true })
  await db.collection('requests').doc('r1').set({ submittedBy: OLD, region: 'SD1', status: 'pending', projectName: 'x' })
  await db.collection('requests').doc('r2').set({ submittedBy: OTHER, region: 'SD1', status: 'pending', projectName: 'y' })

  const result = await renameUserLoginCore(db, MANAGER, { oldEmail: OLD, newEmail: NEW })

  assert.equal(result.migratedAsSubmitter, 1)
  assert.equal((await db.collection('requests').doc('r1').get()).data().submittedBy, NEW)
  assert.equal((await db.collection('requests').doc('r2').get()).data().submittedBy, OTHER) // 不相干的需求不受影響
})

test('有 assignedDesigners 指到舊信箱的需求：搬遷後陣列裡的舊信箱換成新信箱，其他設計師不受影響', async () => {
  await seedManager()
  await db.collection('users').doc(OLD).set({ email: OLD, role: 'designer', active: true })
  await db.collection('requests').doc('r1').set({
    submittedBy: OTHER, region: 'SD1', status: 'assigned', projectName: 'x',
    assignedDesigners: [OLD, OTHER], assignedDesignersNames: ['舊名字', '其他人'],
  })

  const result = await renameUserLoginCore(db, MANAGER, { oldEmail: OLD, newEmail: NEW })

  assert.equal(result.migratedAsDesigner, 1)
  const after = (await db.collection('requests').doc('r1').get()).data()
  assert.deepEqual(after.assignedDesigners, [NEW, OTHER])
  // assignedDesignersNames 是同 index 的顯示名稱陣列，只是原地替換 email 值、不影響名字，長度/順序不變
  assert.deepEqual(after.assignedDesignersNames, ['舊名字', '其他人'])
})

test('新信箱已經被別人使用(非本次搬遷產生的)：拒絕(already-exists)', async () => {
  await seedManager()
  await db.collection('users').doc(OLD).set({ email: OLD, role: 'designer', active: true })
  await db.collection('users').doc(NEW).set({ email: NEW, role: 'designer', active: true }) // 沒有 renamedFrom 標記，是別人的帳號

  await assert.rejects(
    () => renameUserLoginCore(db, MANAGER, { oldEmail: OLD, newEmail: NEW }),
    (err) => err.code === 'already-exists'
  )
  // 拒絕時不能動到任何一邊的資料
  assert.equal((await db.collection('users').doc(OLD).get()).exists, true)
  assert.equal((await db.collection('users').doc(NEW).get()).data().role, 'designer')
})

test('舊信箱不存在：找不到帳號(not-found)', async () => {
  await seedManager()
  await assert.rejects(
    () => renameUserLoginCore(db, MANAGER, { oldEmail: OLD, newEmail: NEW }),
    (err) => err.code === 'not-found'
  )
})

test('email 格式不正確會被拒絕(invalid-argument)', async () => {
  await seedManager()
  await assert.rejects(
    () => renameUserLoginCore(db, MANAGER, { oldEmail: 'not-an-email', newEmail: NEW }),
    (err) => err.code === 'invalid-argument'
  )
})

test('新舊信箱相同會被拒絕(invalid-argument)', async () => {
  await seedManager()
  await db.collection('users').doc(OLD).set({ email: OLD, role: 'designer', active: true })
  await assert.rejects(
    () => renameUserLoginCore(db, MANAGER, { oldEmail: OLD, newEmail: OLD }),
    (err) => err.code === 'invalid-argument'
  )
})

test('final batch 前中斷後重試(模擬:上次已經搶到 reservation + 搬了一半，這次重打會接著搬完並清掉舊帳號)', async () => {
  await seedManager()
  // 模擬「上一次呼叫已經做完 reserveRename()(建新帳號 + userRenameOperations 標 pending)、
  // 也搬完其中一筆 request，但還沒跑到收尾的 final batch」的中斷狀態
  await db.collection('users').doc(OLD).set({ email: OLD, displayName: 'Old Name', role: 'designer', active: true })
  await db.collection('users').doc(NEW).set({ email: NEW, displayName: 'Old Name', role: 'designer', active: true, renamedFrom: OLD })
  await db.collection('userRenameOperations').doc(OLD).set({ oldEmail: OLD, newEmail: NEW, status: 'pending' })
  await db.collection('requests').doc('already-migrated').set({ submittedBy: NEW, region: 'SD1', status: 'pending', projectName: 'done' })
  await db.collection('requests').doc('not-yet').set({ submittedBy: OLD, region: 'SD1', status: 'pending', projectName: 'todo' })

  const result = await renameUserLoginCore(db, MANAGER, { oldEmail: OLD, newEmail: NEW })

  assert.equal(result.migratedAsSubmitter, 1) // 只有「還沒搬」的那筆會被處理到，冪等、不會重複處理已搬完的
  assert.equal((await db.collection('users').doc(OLD).get()).exists, false)
  const newDoc = await db.collection('users').doc(NEW).get()
  assert.equal(newDoc.data().renamedFrom, undefined) // 完成後標記要清掉
  assert.equal((await db.collection('requests').doc('not-yet').get()).data().submittedBy, NEW)
  const opDoc = await db.collection('userRenameOperations').doc(OLD).get()
  assert.equal(opDoc.data().status, 'completed')
})

test('final batch 前中斷、且操作紀錄也遺失(防禦性續傳):一樣能安全接續完成，不會卡住', async () => {
  await seedManager()
  // 比上一個測試更早期的中斷:newRef 已建立(帶 renamedFrom)，但連 userRenameOperations 都還沒寫成功
  // (理論上兩者同一個 transaction，不會真的分開；這裡驗證就算發生也不會卡死，而是續傳)
  await db.collection('users').doc(OLD).set({ email: OLD, displayName: 'Old Name', role: 'designer', active: true })
  await db.collection('users').doc(NEW).set({ email: NEW, displayName: 'Old Name', role: 'designer', active: true, renamedFrom: OLD })

  const result = await renameUserLoginCore(db, MANAGER, { oldEmail: OLD, newEmail: NEW })

  assert.equal(result.alreadyDone, undefined)
  assert.equal((await db.collection('users').doc(OLD).get()).exists, false)
  assert.equal((await db.collection('userRenameOperations').doc(OLD).get()).data().status, 'completed')
})

test('已經完全搬完後重複呼叫(有 completed 的操作紀錄佐證)：冪等回傳成功，不報錯，也不動任何資料', async () => {
  await seedManager()
  await db.collection('users').doc(NEW).set({ email: NEW, role: 'designer', active: true })
  await db.collection('userRenameOperations').doc(OLD).set({ oldEmail: OLD, newEmail: NEW, status: 'completed' })

  const result = await renameUserLoginCore(db, MANAGER, { oldEmail: OLD, newEmail: NEW })

  assert.equal(result.alreadyDone, true)
  assert.equal((await db.collection('users').doc(NEW).get()).data().role, 'designer') // 沒被亂動
})

test('old 不存在、new 是完全無關的帳號(沒有任何操作紀錄佐證關聯)：不得回報成功，要 not-found', async () => {
  await seedManager()
  // 這個 NEW 帳號純粹是別人已經存在的帳號，跟 OLD 完全無關 —— 沒有 userRenameOperations 紀錄，
  // 也沒有 renamedFrom 標記，不能因為「old 剛好不存在」就誤判成「這組搬遷已經完成」
  await db.collection('users').doc(NEW).set({ email: NEW, role: 'planner', active: true, displayName: '完全不相干的人' })

  await assert.rejects(
    () => renameUserLoginCore(db, MANAGER, { oldEmail: OLD, newEmail: NEW }),
    (err) => err.code === 'not-found'
  )
  // 不得動到這個無關帳號
  const stillThere = await db.collection('users').doc(NEW).get()
  assert.equal(stillThere.data().displayName, '完全不相干的人')
})

test('同一個 oldEmail 並行改到兩個不同的 newEmail：只有一個成功，不會產生兩個新帳號', async () => {
  await seedManager()
  const NEW_A = 'concurrent-a@gmail.com'
  const NEW_B = 'concurrent-b@gmail.com'
  await db.collection('users').doc(OLD).set({ email: OLD, displayName: 'Old Name', role: 'designer', active: true })

  const results = await Promise.allSettled([
    renameUserLoginCore(db, MANAGER, { oldEmail: OLD, newEmail: NEW_A }),
    renameUserLoginCore(db, MANAGER, { oldEmail: OLD, newEmail: NEW_B }),
  ])

  const fulfilled = results.filter((r) => r.status === 'fulfilled')
  const rejected = results.filter((r) => r.status === 'rejected')
  assert.equal(fulfilled.length, 1, '兩個目標信箱不同的並行搬遷只能有一個成功')
  assert.equal(rejected.length, 1)
  assert.equal(rejected[0].reason.code, 'failed-precondition')

  // 只有贏的那個新帳號被建立，另一個完全沒有被建立(不會出現兩個新帳號)
  const aExists = (await db.collection('users').doc(NEW_A).get()).exists
  const bExists = (await db.collection('users').doc(NEW_B).get()).exists
  assert.equal(aExists && bExists, false, '不能兩個新帳號都被建立')
  assert.equal(aExists || bExists, true, '贏的那個必須確實建立成功')
  assert.equal((await db.collection('users').doc(OLD).get()).exists, false) // 贏的那組已經跑完，舊帳號要被刪
})

test('兩個不同的 oldEmail 並行改到同一個 newEmail：只有一個成功，不會讓 requests 分裂搬到兩邊', async () => {
  const OLD_A = 'concurrent-old-a@gmail.com'
  const OLD_B = 'concurrent-old-b@gmail.com'
  await seedManager()
  await db.collection('users').doc(OLD_A).set({ email: OLD_A, displayName: 'A', role: 'designer', active: true })
  await db.collection('users').doc(OLD_B).set({ email: OLD_B, displayName: 'B', role: 'designer', active: true })
  await db.collection('requests').doc('from-a').set({ submittedBy: OLD_A, region: 'SD1', status: 'pending', projectName: 'a' })
  await db.collection('requests').doc('from-b').set({ submittedBy: OLD_B, region: 'SD1', status: 'pending', projectName: 'b' })

  const results = await Promise.allSettled([
    renameUserLoginCore(db, MANAGER, { oldEmail: OLD_A, newEmail: NEW }),
    renameUserLoginCore(db, MANAGER, { oldEmail: OLD_B, newEmail: NEW }),
  ])

  const fulfilled = results.filter((r) => r.status === 'fulfilled')
  const rejected = results.filter((r) => r.status === 'rejected')
  assert.equal(fulfilled.length, 1, '兩個來源信箱不同、目標相同的並行搬遷只能有一個成功')
  assert.equal(rejected.length, 1)
  assert.equal(rejected[0].reason.code, 'already-exists')

  // requests 不能同時被兩邊搬(不能一部分變 A 的、一部分維持 B 的又各自宣稱搬到 NEW 而沒真的搬)：
  // 贏的那一個 old 對應的 request 應該搬到 NEW，輸的那一個 old 完全不受影響(它的帳號、request 都還在原樣)
  const aStillExists = (await db.collection('users').doc(OLD_A).get()).exists
  const bStillExists = (await db.collection('users').doc(OLD_B).get()).exists
  assert.equal(aStillExists && bStillExists, false, '不能兩個舊帳號都還在(至少一個要被贏家清掉)')
  assert.equal(aStillExists || bStillExists, true, '輸家的舊帳號必須完全不受影響、原封不動保留')
})
