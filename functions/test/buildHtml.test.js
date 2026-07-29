// 純函式測試，不連任何 Firebase 服務（不觸碰正式或本機的 Firestore/Storage/Auth）。
// 執行：npm test（functions 目錄下）
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHtml } from '../index.js'

test('buildHtml 對 HTML 特殊字元做逸出，避免郵件內容被注入標籤', () => {
  const html = buildHtml({ projectName: '<script>alert(1)</script>', submittedBy: 'x@example.com' })
  // 原始碼只 escape 開頭的 `<`（足以讓瀏覽器/郵件客戶端不再把它解析成標籤開頭），
  // 不強求連 `>` 都轉成 &gt;——這裡驗證的是「不會被當成標籤解析」這個安全性質，
  // 而不是要求特定的逸出字元組合。
  assert.ok(!html.includes('<script>alert(1)</script>'), '原始未逸出的 <script> 標籤不應出現在輸出中')
  assert.ok(html.includes('&lt;script>alert(1)&lt;/script>'), '應該看到 < 被逸出成 &lt;')
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

test('buildHtml 附件連結會被列出，且檔名同樣逸出特殊字元', () => {
  const html = buildHtml({
    projectName: 'x',
    attachments: [{ name: '<img src=x onerror=alert(1)>.pdf', url: 'https://example.com/f.pdf' }],
  })
  assert.ok(html.includes('https://example.com/f.pdf'))
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'))
  assert.ok(html.includes('&lt;img'))
})
