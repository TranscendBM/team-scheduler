// 針對單一 Rules fixture，只執行「一次合法的 create」操作，並回報成功/失敗與錯誤訊息。
// 用 process.env.RULES_FILE 指定要載入哪個 fixture(l2-pass.rules 或 l3-fail.rules)。
// 刻意不用 vitest —— 避免測試框架本身的額外呼叫/coverage 收集混進同一個 process 的行為，
// 讓重現條件盡量單純。詳細背景、完整變體矩陣(A-O)跟結論見 docs/firestore-rules-expression-limit.md。
//
// 執行方式(需要本機已安裝 Java，且要先起 Firestore Emulator，見 package.json test:rules 的模式)：
//   firebase emulators:exec --project demo-team-scheduler-rules --only firestore,storage \
//     "node test/fixtures/expression-limit/run-variant.mjs"
// 搭配環境變數 RULES_FILE=l2-pass.rules 或 RULES_FILE=l3-fail.rules。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  initializeTestEnvironment,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'

const DIR = dirname(fileURLToPath(import.meta.url))
const PROJECT_ID = 'demo-team-scheduler-rules'

const rulesFile = process.env.RULES_FILE
if (!rulesFile) {
  console.error('RULES_FILE_NOT_SET (使用 l2-pass.rules 或 l3-fail.rules)')
  process.exit(2)
}
const RULES = readFileSync(join(DIR, rulesFile), 'utf8')

const PLANNER = 'planner.sd1@example.com'
const REQUEST_ID = 'r-fixed-id-for-storagepath-binding'

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
  })

  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', PLANNER), {
      email: PLANNER, role: 'planner', active: true, regions: ['SD1'],
    })
  })

  const db = testEnv.authenticatedContext(PLANNER, { email: PLANNER }).firestore()

  // 10 筆附件，storagePath 精確對應 REQUEST_ID —— 跟真實 isValidRequestCreate 要求的
  // 「合法建立」情境完全一致(這是唯一要測的操作:一次 CREATE)。
  const attachments = Array.from({ length: 10 }, (_, i) => ({
    name: `file${i}.pdf`,
    url: `https://example.com/file${i}.pdf`,
    size: 1024,
    storagePath: `attachments/${REQUEST_ID}/file${i}.pdf`,
  }))

  const payload = {
    projectName: 'x', region: 'SD1', docTypes: ['banner'], dueDate: '2026-08-01',
    description: 'desc', urgent: false, attachments,
    submittedBy: PLANNER, submittedByName: 'Planner SD1',
    status: 'pending', createdAt: serverTimestamp(),
  }

  let outcome
  try {
    await assertSucceeds(setDoc(doc(db, 'requests', REQUEST_ID), payload))
    outcome = 'PASS'
  } catch (err) {
    outcome = `FAIL: ${err && err.message ? err.message : String(err)}`
  }

  console.log(`CREATE_RESULT: ${outcome}`)
  await testEnv.cleanup()
  process.exit(outcome === 'PASS' ? 0 : 1)
}

main().catch((err) => {
  console.error('RUNNER_CRASHED:', err)
  process.exit(1)
})
