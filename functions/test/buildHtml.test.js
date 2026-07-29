// 純函式測試，不連任何 Firebase 服務(不觸碰正式或本機的 Firestore/Storage/Auth)。
// 執行：npm test（functions 目錄下）
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHtml, escapeHtml, safeAttachmentUrl } from '../index.js'

const LEGIT_URL = 'https://firebasestorage.googleapis.com/v0/b/team-scheduler-dc7ce.firebasestorage.app/o/attachments%2Freq123%2Ffile-abc.pdf?alt=media&token=xyz'

test('escapeHtml 涵蓋 & < > " \' 五種特殊字元，且順序正確(先跳脫 & 才不會把後面產生的實體重複跳脫)', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;')
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;')
})

test('escapeHtml 對 null/undefined 安全，不會噴錯', () => {
  assert.equal(escapeHtml(null), '')
  assert.equal(escapeHtml(undefined), '')
})

test('buildHtml 對 HTML 特殊字元做完整逸出，避免郵件內容被注入標籤', () => {
  const html = buildHtml({ projectName: '<script>alert(1)</script>', submittedBy: 'x@example.com' })
  assert.ok(!html.includes('<script>alert(1)</script>'), '原始未逸出的 <script> 標籤不應出現在輸出中')
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), '< 和 > 都應該被逸出')
})

test('buildHtml 缺少選填欄位時仍能正常產生內容，不會噴錯', () => {
  const html = buildHtml({ projectName: '測試專案' })
  assert.ok(html.includes('測試專案'))
  assert.ok(html.includes('未指定')) // dueDate 預設文字
  assert.ok(html.includes('（無）')) // description/reviewNote/comment 預設文字
})

test('buildHtml 急件會顯示 🔥 標記', () => {
  const html = buildHtml({ projectName: 'x', urgent: true })
  assert.ok(html.includes('🔥 是'))
})

test('buildHtml 合法的 Firebase Storage 附件網址會被列成連結，檔名同樣逸出特殊字元', () => {
  const html = buildHtml({
    projectName: 'x',
    attachments: [{ name: '<img src=x onerror=alert(1)>.pdf', url: LEGIT_URL }],
  })
  // href 屬性值裡的 & 依 HTML 規則要逸出成 &amp;，所以比對時用逸出過的形式
  assert.ok(html.includes(`href="${LEGIT_URL.replace(/&/g, '&amp;')}"`))
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'))
  assert.ok(html.includes('&lt;img'))
})

test('buildHtml 對不合法的附件網址不會產生 <a> 連結，只顯示純文字(且檔名仍逸出)', () => {
  const html = buildHtml({
    projectName: 'x',
    attachments: [{ name: '假附件.pdf', url: 'https://example.com/f.pdf' }],
  })
  assert.ok(!html.includes('<a href="https://example.com/f.pdf"'))
  assert.ok(html.includes('假附件.pdf'))
  assert.ok(html.includes('連結無效'))
})

test('safeAttachmentUrl：合法的 Firebase Storage attachments/ 網址通過', () => {
  assert.equal(safeAttachmentUrl(LEGIT_URL), LEGIT_URL)
})

test('safeAttachmentUrl：javascript: 偽造網址被拒', () => {
  assert.equal(safeAttachmentUrl('javascript:alert(1)'), null)
})

test('safeAttachmentUrl：data: URI 被拒', () => {
  assert.equal(safeAttachmentUrl('data:text/html,<script>alert(1)</script>'), null)
})

test('safeAttachmentUrl：非 https(例如 http)被拒', () => {
  assert.equal(safeAttachmentUrl(LEGIT_URL.replace('https://', 'http://')), null)
})

test('safeAttachmentUrl：href 引號注入(網址裡夾帶 " 企圖跳脫屬性)不會在回傳值中留下未跳脫的雙引號', () => {
  // URL 解析器本身就會把路徑/查詢字串裡的原始 " 自動 percent-encode 成 %22，
  // 所以就算通過結構檢查，回傳值也不會包含可以跳脫 href="..." 屬性的原始雙引號字元
  const result = safeAttachmentUrl(`${LEGIT_URL}" onerror="alert(1)`)
  if (result !== null) assert.ok(!result.includes('"'), '回傳的網址不應包含未跳脫的雙引號')
})

test('buildHtml：附件網址夾帶雙引號注入時，產生的 <a href="..."> 屬性不會被跳脫(沒有裸露的 onerror= 屬性被注入)', () => {
  const html = buildHtml({
    projectName: 'x',
    attachments: [{ name: 'a.pdf', url: `${LEGIT_URL}" onerror="alert(1)` }],
  })
  assert.ok(!html.includes('" onerror="alert(1)'), '不應該出現未跳脫的屬性跳脫注入')
})

test('safeAttachmentUrl：指向別的 bucket 的網址被拒', () => {
  assert.equal(safeAttachmentUrl(LEGIT_URL.replace('team-scheduler-dc7ce.firebasestorage.app', 'evil-bucket.firebasestorage.app')), null)
})

test('safeAttachmentUrl：合法 bucket 但路徑不在 attachments/ 底下(惡意路徑)被拒', () => {
  const evil = 'https://firebasestorage.googleapis.com/v0/b/team-scheduler-dc7ce.firebasestorage.app/o/secrets%2Fadmin-key.json?alt=media'
  assert.equal(safeAttachmentUrl(evil), null)
})

test('safeAttachmentUrl：host 不是 firebasestorage.googleapis.com 的偽造網址被拒', () => {
  assert.equal(safeAttachmentUrl('https://firebasestorage.googleapis.com.evil.com/v0/b/x/o/attachments%2Fa'), null)
})

test('safeAttachmentUrl：完全不是網址的字串不會噴錯，回傳 null', () => {
  assert.equal(safeAttachmentUrl('not a url'), null)
  assert.equal(safeAttachmentUrl(''), null)
  assert.equal(safeAttachmentUrl(undefined), null)
})
