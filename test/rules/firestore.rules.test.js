// Firestore 安全規則測試 —— 一律連本機 Firebase Emulator，絕不連正式專案。
// initializeTestEnvironment 這個函式本身就是 emulator-only 設計（無法指向正式 Firebase），
// 加上 `npm run test:rules` 是透過 `firebase emulators:exec` 啟動本機模擬器後才執行本檔，
// 從機制上就避免誤連/誤寫正式資料庫。
//
// 執行方式：npm run test:rules（需要本機已安裝 Java，供 Firestore Emulator 使用）
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, serverTimestamp, Timestamp,
} from 'firebase/firestore'

const PROJECT_ID = 'team-scheduler-rules-test'
const RULES = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')

const MANAGER = 'manager@example.com'
const DESIGNER_A = 'designer.a@example.com'
const DESIGNER_B = 'designer.b@example.com'
const PLANNER_SD1 = 'planner.sd1@example.com'
const PLANNER_SD2 = 'planner.sd2@example.com'
const DEACTIVATED = 'deactivated@example.com'
const STRANGER = 'stranger@example.com' // 未在 users 白名單內

let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
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
    await setDoc(doc(db, 'users', DESIGNER_A), { email: DESIGNER_A, role: 'designer', active: true })
    await setDoc(doc(db, 'users', DESIGNER_B), { email: DESIGNER_B, role: 'designer', active: true })
    await setDoc(doc(db, 'users', PLANNER_SD1), { email: PLANNER_SD1, role: 'planner', active: true, regions: ['SD1'] })
    await setDoc(doc(db, 'users', PLANNER_SD2), { email: PLANNER_SD2, role: 'planner', active: true, regions: ['SD2'] })
    await setDoc(doc(db, 'users', DEACTIVATED), { email: DEACTIVATED, role: 'planner', active: false, regions: ['SD1'] })
  })
})

function dbAs(email) {
  return testEnv.authenticatedContext(email, { email }).firestore()
}
function dbAnon() {
  return testEnv.unauthenticatedContext().firestore()
}
async function seedRequest(id, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'requests', id), data)
  })
}

describe('whitelisted() — 白名單與停用帳號', () => {
  it('未登入不能讀 requests', async () => {
    await seedRequest('r1', { submittedBy: PLANNER_SD1, region: 'SD1', status: 'pending', projectName: 'x' })
    await assertFails(getDoc(doc(dbAnon(), 'requests', 'r1')))
  })

  it('不在白名單（users 文件不存在）不能讀 requests', async () => {
    await seedRequest('r1', { submittedBy: PLANNER_SD1, region: 'SD1', status: 'pending', projectName: 'x' })
    await assertFails(getDoc(doc(dbAs(STRANGER), 'requests', 'r1')))
  })

  it('帳號已停用（active:false）即使角色/regions 正確也不能讀 requests', async () => {
    await seedRequest('r1', { submittedBy: PLANNER_SD1, region: 'SD1', status: 'pending', projectName: 'x' })
    await assertFails(getDoc(doc(dbAs(DEACTIVATED), 'requests', 'r1')))
  })

  it('白名單內、啟用中、負責區域相符的 planner 可以讀', async () => {
    await seedRequest('r1', { submittedBy: PLANNER_SD1, region: 'SD1', status: 'pending', projectName: 'x' })
    await assertSucceeds(getDoc(doc(dbAs(PLANNER_SD1), 'requests', 'r1')))
  })

  it('manager 可寫 users；其他角色不行', async () => {
    await assertSucceeds(setDoc(doc(dbAs(MANAGER), 'users', 'new@example.com'), { email: 'new@example.com', role: 'designer', active: true }))
    await assertFails(setDoc(doc(dbAs(DESIGNER_A), 'users', 'new2@example.com'), { email: 'new2@example.com', role: 'designer', active: true }))
  })
})

describe('requests create — 必要欄位/型別/允許欄位驗證', () => {
  const base = {
    urgent: false, region: 'SD1', projectName: '測試專案', docTypes: ['Banner'],
    dueDate: '2026-08-01', description: '', attachments: [],
    submittedByName: 'Planner SD1', status: 'pending', createdAt: serverTimestamp(),
  }

  it('提交人建立自己的需求成功', async () => {
    await assertSucceeds(addDoc(collection(dbAs(PLANNER_SD1), 'requests'), { ...base, submittedBy: PLANNER_SD1 }))
  })

  it('偽造他人的 submittedBy 會被擋', async () => {
    await assertFails(addDoc(collection(dbAs(PLANNER_SD1), 'requests'), { ...base, submittedBy: PLANNER_SD2 }))
  })

  it('建立時 status 不是 pending 會被擋', async () => {
    await assertFails(addDoc(collection(dbAs(PLANNER_SD1), 'requests'), { ...base, submittedBy: PLANNER_SD1, status: 'assigned' }))
  })

  it('缺少必要欄位（projectName 空字串）會被擋', async () => {
    await assertFails(addDoc(collection(dbAs(PLANNER_SD1), 'requests'), { ...base, submittedBy: PLANNER_SD1, projectName: '' }))
  })

  it('夾帶允許清單以外的欄位會被擋', async () => {
    await assertFails(addDoc(collection(dbAs(PLANNER_SD1), 'requests'), { ...base, submittedBy: PLANNER_SD1, hacked: true }))
  })

  it('attachments 型別錯誤（不是 list）會被擋', async () => {
    await assertFails(addDoc(collection(dbAs(PLANNER_SD1), 'requests'), { ...base, submittedBy: PLANNER_SD1, attachments: 'not-a-list' }))
  })
})

describe('requests 狀態機 — designer 只能單步推進', () => {
  beforeEach(async () => {
    await seedRequest('req-assigned', {
      submittedBy: PLANNER_SD1, region: 'SD1', status: 'assigned',
      assignedDesigners: [DESIGNER_A], projectName: 'x', dueDate: '2026-08-01',
    })
  })

  it('assigned → in_progress（合法單步）成功', async () => {
    await assertSucceeds(updateDoc(doc(dbAs(DESIGNER_A), 'requests', 'req-assigned'), {
      status: 'in_progress', startedAt: serverTimestamp(),
    }))
  })

  it('assigned → completed（跳階）被擋', async () => {
    await assertFails(updateDoc(doc(dbAs(DESIGNER_A), 'requests', 'req-assigned'), {
      status: 'completed', completedAt: serverTimestamp(),
    }))
  })

  it('assigned → 任意亂填字串被擋', async () => {
    await assertFails(updateDoc(doc(dbAs(DESIGNER_A), 'requests', 'req-assigned'), { status: 'archived' }))
  })

  it('未被指派的設計師（DESIGNER_B）不能改狀態', async () => {
    await assertFails(updateDoc(doc(dbAs(DESIGNER_B), 'requests', 'req-assigned'), {
      status: 'in_progress', startedAt: serverTimestamp(),
    }))
  })

  it('推進時寫入不相符的時間欄位（只允許 startedAt，卻寫 completedAt）被擋', async () => {
    await assertFails(updateDoc(doc(dbAs(DESIGNER_A), 'requests', 'req-assigned'), {
      status: 'in_progress', completedAt: serverTimestamp(),
    }))
  })

  it('倒退（reviewing → in_progress）被擋', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'requests', 'req-assigned'), { status: 'reviewing', reviewingAt: Timestamp.now() })
    })
    await assertFails(updateDoc(doc(dbAs(DESIGNER_A), 'requests', 'req-assigned'), {
      status: 'in_progress', startedAt: serverTimestamp(),
    }))
  })
})

describe('requests 狀態機 — planner 只能把「非 pending/rejected」的負責區域需求結案', () => {
  it('pending 直接被 planner 結案 → 擋（不能跳過審核）', async () => {
    await seedRequest('req-pending', { submittedBy: DESIGNER_A, region: 'SD1', status: 'pending', projectName: 'x' })
    await assertFails(updateDoc(doc(dbAs(PLANNER_SD1), 'requests', 'req-pending'), {
      status: 'completed', completedAt: serverTimestamp(),
    }))
  })

  it('rejected 被 planner 結案 → 擋', async () => {
    await seedRequest('req-rejected', { submittedBy: DESIGNER_A, region: 'SD1', status: 'rejected', projectName: 'x' })
    await assertFails(updateDoc(doc(dbAs(PLANNER_SD1), 'requests', 'req-rejected'), {
      status: 'completed', completedAt: serverTimestamp(),
    }))
  })

  it('reviewing 被負責區域的 planner 結案 → 成功', async () => {
    await seedRequest('req-reviewing', { submittedBy: DESIGNER_A, region: 'SD1', status: 'reviewing', projectName: 'x' })
    await assertSucceeds(updateDoc(doc(dbAs(PLANNER_SD1), 'requests', 'req-reviewing'), {
      status: 'completed', completedAt: serverTimestamp(),
    }))
  })

  it('非負責區域（SD2 的 planner 對 SD1 需求）結案 → 擋', async () => {
    await seedRequest('req-sd1', { submittedBy: DESIGNER_A, region: 'SD1', status: 'reviewing', projectName: 'x' })
    await assertFails(updateDoc(doc(dbAs(PLANNER_SD2), 'requests', 'req-sd1'), {
      status: 'completed', completedAt: serverTimestamp(),
    }))
  })
})

describe('requests — 提交人只能在 pending 時編輯自己的需求', () => {
  it('提交人編輯自己的 pending 需求成功', async () => {
    await seedRequest('own-pending', { submittedBy: PLANNER_SD1, region: 'SD1', status: 'pending', projectName: 'x' })
    await assertSucceeds(updateDoc(doc(dbAs(PLANNER_SD1), 'requests', 'own-pending'), { projectName: 'y' }))
  })

  it('已審核（assigned）後提交人不能再編輯', async () => {
    await seedRequest('own-assigned', { submittedBy: PLANNER_SD1, region: 'SD1', status: 'assigned', projectName: 'x', assignedDesigners: [DESIGNER_A] })
    await assertFails(updateDoc(doc(dbAs(PLANNER_SD1), 'requests', 'own-assigned'), { projectName: 'y' }))
  })

  it('不能編輯別人的 pending 需求', async () => {
    await seedRequest('other-pending', { submittedBy: PLANNER_SD2, region: 'SD2', status: 'pending', projectName: 'x' })
    await assertFails(updateDoc(doc(dbAs(PLANNER_SD1), 'requests', 'other-pending'), { projectName: 'y' }))
  })

  it('提交人不能藉編輯偷改 status', async () => {
    await seedRequest('own-pending2', { submittedBy: PLANNER_SD1, region: 'SD1', status: 'pending', projectName: 'x' })
    await assertFails(updateDoc(doc(dbAs(PLANNER_SD1), 'requests', 'own-pending2'), { status: 'assigned' }))
  })
})

describe('requests 狀態機 — manager 核准/駁回', () => {
  it('核准（pending → assigned）帶正確欄位成功', async () => {
    await seedRequest('to-approve', { submittedBy: PLANNER_SD1, region: 'SD1', status: 'pending', projectName: 'x' })
    await assertSucceeds(updateDoc(doc(dbAs(MANAGER), 'requests', 'to-approve'), {
      status: 'assigned', assignedDesigners: [DESIGNER_A], assignedDesignersNames: ['Designer A'],
      reviewedBy: MANAGER, reviewedAt: serverTimestamp(), reviewNote: '', comment: '', dueDate: '2026-08-01',
    }))
  })

  it('核准卻沒有指派任何設計師 → 擋', async () => {
    await seedRequest('to-approve2', { submittedBy: PLANNER_SD1, region: 'SD1', status: 'pending', projectName: 'x' })
    await assertFails(updateDoc(doc(dbAs(MANAGER), 'requests', 'to-approve2'), {
      status: 'assigned', assignedDesigners: [], reviewedBy: MANAGER, reviewedAt: serverTimestamp(),
    }))
  })

  it('駁回（pending → rejected）帶原因成功', async () => {
    await seedRequest('to-reject', { submittedBy: PLANNER_SD1, region: 'SD1', status: 'pending', projectName: 'x' })
    await assertSucceeds(updateDoc(doc(dbAs(MANAGER), 'requests', 'to-reject'), {
      status: 'rejected', reviewedBy: MANAGER, reviewedAt: serverTimestamp(), rejectReason: '資訊不足',
    }))
  })

  it('manager 把 status 改成不存在的 enum 值 → 擋', async () => {
    await seedRequest('to-hack', { submittedBy: PLANNER_SD1, region: 'SD1', status: 'pending', projectName: 'x' })
    await assertFails(updateDoc(doc(dbAs(MANAGER), 'requests', 'to-hack'), { status: 'archived' }))
  })

  it('manager 事後編輯已發稿需求的指派/交期（不改狀態）成功', async () => {
    await seedRequest('to-edit', { submittedBy: PLANNER_SD1, region: 'SD1', status: 'assigned', projectName: 'x', assignedDesigners: [DESIGNER_A] })
    await assertSucceeds(updateDoc(doc(dbAs(MANAGER), 'requests', 'to-edit'), {
      assignedDesigners: [DESIGNER_A, DESIGNER_B], assignedDesignersNames: ['A', 'B'], dueDate: '2026-09-01', comment: 'hi', reviewNote: '',
    }))
  })

  it('manager 可刪除需求；其他角色不行', async () => {
    await seedRequest('to-delete', { submittedBy: PLANNER_SD1, region: 'SD1', status: 'pending', projectName: 'x' })
    await assertFails(deleteDoc(doc(dbAs(PLANNER_SD1), 'requests', 'to-delete')))
    await assertSucceeds(deleteDoc(doc(dbAs(MANAGER), 'requests', 'to-delete')))
  })
})

describe('projects / people / leaves / settings / hbl* — 讀白名單、寫僅 manager', () => {
  const collections = ['projects', 'people', 'leaves', 'hblPayments', 'hblSchedule', 'hblAdStatus']

  for (const col of collections) {
    it(`${col}: 白名單使用者可讀`, async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), col, 'seed'), { name: 'x' })
      })
      await assertSucceeds(getDoc(doc(dbAs(DESIGNER_A), col, 'seed')))
    })

    it(`${col}: designer 不能寫（不能把前端隱藏按鈕當唯一防線）`, async () => {
      await assertFails(setDoc(doc(dbAs(DESIGNER_A), col, 'x'), { name: 'x' }))
    })

    it(`${col}: manager 可寫`, async () => {
      await assertSucceeds(setDoc(doc(dbAs(MANAGER), col, 'x'), { name: 'x' }))
    })
  }

  it('settings/permissions 只有 manager 能寫', async () => {
    await assertFails(setDoc(doc(dbAs(DESIGNER_A), 'settings', 'permissions'), { pages: {} }))
    await assertSucceeds(setDoc(doc(dbAs(MANAGER), 'settings', 'permissions'), { pages: {} }))
  })
})
