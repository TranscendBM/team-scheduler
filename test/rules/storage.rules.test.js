// Storage 安全規則測試 —— 一律連本機 Firebase Emulator，絕不連正式專案（理由同 firestore.rules.test.js）。
// 涵蓋情境：未登入、非白名單、停用帳號、提交人、其他使用者、manager、超過 10MB。
//
// 執行方式：npm run test:rules（需要本機已安裝 Java；Storage emulator 與 Firestore emulator
// 需同時啟動，Storage Rules 內的 firestore.get()/firestore.exists() 跨服務查詢才解得出來）
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import { ref, uploadBytes, deleteObject } from 'firebase/storage'

// 必須跟 firestore.rules.test.js 用同一個 project id，理由見該檔案 PROJECT_ID 旁的說明。
const PROJECT_ID = 'demo-team-scheduler-rules'
const FIRESTORE_RULES = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')
const STORAGE_RULES = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8')

const MANAGER = 'manager@example.com'
const SUBMITTER = 'submitter@example.com'
const OTHER_USER = 'other@example.com'
const DEACTIVATED = 'deactivated@example.com'
const STRANGER = 'stranger@example.com' // 不在白名單

const SMALL_FILE = new Uint8Array(1024) // 1KB
const BIG_FILE = new Uint8Array(11 * 1024 * 1024) // 11MB，超過 10MB 上限

let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: FIRESTORE_RULES, host: '127.0.0.1', port: 8080 },
    storage: { rules: STORAGE_RULES, host: '127.0.0.1', port: 9199 },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users', MANAGER), { email: MANAGER, role: 'manager', active: true })
    await setDoc(doc(db, 'users', SUBMITTER), { email: SUBMITTER, role: 'planner', active: true, regions: ['SD1'] })
    await setDoc(doc(db, 'users', OTHER_USER), { email: OTHER_USER, role: 'designer', active: true })
    await setDoc(doc(db, 'users', DEACTIVATED), { email: DEACTIVATED, role: 'planner', active: false })
    // pending 需求，提交人是 SUBMITTER
    await setDoc(doc(db, 'requests', 'req-pending'), { submittedBy: SUBMITTER, region: 'SD1', status: 'pending', projectName: 'x' })
    // 已審核需求（非 pending）
    await setDoc(doc(db, 'requests', 'req-assigned'), { submittedBy: SUBMITTER, region: 'SD1', status: 'assigned', projectName: 'x' })
  })
})

function storageAs(email) {
  return testEnv.authenticatedContext(email, { email }).storage()
}
function storageAnon() {
  return testEnv.unauthenticatedContext().storage()
}

describe('Storage attachments 規則', () => {
  it('未登入：上傳被擋', async () => {
    await assertFails(uploadBytes(ref(storageAnon(), 'attachments/req-pending/a.pdf'), SMALL_FILE))
  })

  it('非白名單（stranger）：上傳被擋', async () => {
    await assertFails(uploadBytes(ref(storageAs(STRANGER), 'attachments/req-pending/a.pdf'), SMALL_FILE))
  })

  it('已停用帳號：即使原本是該需求提交人也被擋', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'requests', 'req-by-deactivated'), { submittedBy: DEACTIVATED, region: 'SD1', status: 'pending', projectName: 'x' })
    })
    await assertFails(uploadBytes(ref(storageAs(DEACTIVATED), 'attachments/req-by-deactivated/a.pdf'), SMALL_FILE))
  })

  it('提交人：可以上傳到自己那筆仍是 pending 的需求', async () => {
    await assertSucceeds(uploadBytes(ref(storageAs(SUBMITTER), 'attachments/req-pending/a.pdf'), SMALL_FILE))
  })

  it('提交人：需求一旦不是 pending（已審核）就不能再上傳', async () => {
    await assertFails(uploadBytes(ref(storageAs(SUBMITTER), 'attachments/req-assigned/a.pdf'), SMALL_FILE))
  })

  it('其他使用者（非提交人、非 manager）：不能上傳到別人的需求', async () => {
    await assertFails(uploadBytes(ref(storageAs(OTHER_USER), 'attachments/req-pending/a.pdf'), SMALL_FILE))
  })

  it('manager：任何需求（含非 pending）都可以上傳', async () => {
    await assertSucceeds(uploadBytes(ref(storageAs(MANAGER), 'attachments/req-assigned/a.pdf'), SMALL_FILE))
  })

  it('超過 10MB：連合法提交人也會被擋', async () => {
    await assertFails(uploadBytes(ref(storageAs(SUBMITTER), 'attachments/req-pending/big.pdf'), BIG_FILE))
  })

  it('超過 10MB：連 manager 也會被擋', async () => {
    await assertFails(uploadBytes(ref(storageAs(MANAGER), 'attachments/req-pending/big.pdf'), BIG_FILE))
  })

  it('檔名含不允許字元（例如路徑分隔符變形字元）會被擋', async () => {
    await assertFails(uploadBytes(ref(storageAs(SUBMITTER), 'attachments/req-pending/a b.pdf'), SMALL_FILE))
  })

  it('白名單使用者可以讀取附件；未登入不行', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'attachments/req-pending/seed.pdf'), SMALL_FILE)
    })
    await assertSucceeds((async () => {
      const { getDownloadURL } = await import('firebase/storage')
      return getDownloadURL(ref(storageAs(OTHER_USER), 'attachments/req-pending/seed.pdf'))
    })())
  })
})

// delete 沒有 request.resource(新檔案的中繼資料)，跟 create/update 分開驗證，
// 確保 delete 沒有被 create/update 專用的 size/contentType 檢查誤擋(這正是修的那個 bug)。
describe('Storage attachments 刪除規則', () => {
  async function seedFile(path) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), path), SMALL_FILE)
    })
  }

  it('manager 可以刪除任何需求的附件(含非 pending)', async () => {
    await seedFile('attachments/req-assigned/a.pdf')
    await assertSucceeds(deleteObject(ref(storageAs(MANAGER), 'attachments/req-assigned/a.pdf')))
  })

  it('提交人可以刪除自己那筆「仍是 pending」需求的附件', async () => {
    await seedFile('attachments/req-pending/a.pdf')
    await assertSucceeds(deleteObject(ref(storageAs(SUBMITTER), 'attachments/req-pending/a.pdf')))
  })

  it('提交人不能刪除自己那筆已審核(非 pending)需求的附件', async () => {
    await seedFile('attachments/req-assigned/a.pdf')
    await assertFails(deleteObject(ref(storageAs(SUBMITTER), 'attachments/req-assigned/a.pdf')))
  })

  it('非提交人、非 manager 不能刪除別人需求的附件', async () => {
    await seedFile('attachments/req-pending/a.pdf')
    await assertFails(deleteObject(ref(storageAs(OTHER_USER), 'attachments/req-pending/a.pdf')))
  })

  it('未登入不能刪除任何附件', async () => {
    await seedFile('attachments/req-pending/a.pdf')
    await assertFails(deleteObject(ref(storageAnon(), 'attachments/req-pending/a.pdf')))
  })

  it('已停用帳號即使原本是提交人也不能刪除', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'requests', 'req-by-deactivated'), { submittedBy: DEACTIVATED, region: 'SD1', status: 'pending', projectName: 'x' })
    })
    await seedFile('attachments/req-by-deactivated/a.pdf')
    await assertFails(deleteObject(ref(storageAs(DEACTIVATED), 'attachments/req-by-deactivated/a.pdf')))
  })
})
