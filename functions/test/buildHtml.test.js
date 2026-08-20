// 純函式測試，不連任何 Firebase 服務(不觸碰正式或本機的 Firestore/Storage/Auth)。
// 執行：npm test（functions 目錄下）
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHtml, escapeHtml, safeAttachmentUrl, safeAttachmentUrlForRequest, buildCcList, linkifyHtml } from '../index.js'

const LEGIT_URL = 'https://firebasestorage.googleapis.com/v0/b/team-scheduler-dc7ce.firebasestorage.app/o/attachments%2Freq123%2Ffile-abc.pdf?alt=media&token=xyz'
const REQUEST_ID = 'req123'

test('escapeHtml 涵蓋 & < > " \' 五種特殊字元，且順序正確(先跳脫 & 才不會把後面產生的實體重複跳脫)', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;')
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;')
})

test('escapeHtml 對 null/undefined 安全，不會噴錯', () => {
  assert.equal(escapeHtml(null), '')
  assert.equal(escapeHtml(undefined), '')
})

test('buildCcList：多組來源(提交人/主管/勾選的 planner)攤平合併去重', () => {
  const cc = buildCcList(['designer@x.com'], ['submitter@x.com'], ['manager1@x.com', 'manager2@x.com'], ['planner1@x.com'])
  assert.deepEqual([...cc].sort(), ['manager1@x.com', 'manager2@x.com', 'planner1@x.com', 'submitter@x.com'])
})

test('buildCcList：已經在收件人(to)裡的信箱不重複出現在 cc', () => {
  const cc = buildCcList(['designer@x.com', 'planner1@x.com'], ['submitter@x.com'], [], ['planner1@x.com'])
  assert.deepEqual(cc, ['submitter@x.com'])
})

test('buildCcList：拿掉空字串/undefined，並且同一個信箱在不同來源重複出現只留一個', () => {
  const cc = buildCcList([], ['submitter@x.com'], ['submitter@x.com', '', undefined], ['submitter@x.com'])
  assert.deepEqual(cc, ['submitter@x.com'])
})

test('buildCcList：沒有勾選任何 planner(空陣列)也能正常運作', () => {
  const cc = buildCcList(['designer@x.com'], ['submitter@x.com'], ['manager@x.com'], [])
  assert.deepEqual([...cc].sort(), ['manager@x.com', 'submitter@x.com'])
})

test('linkifyHtml：純文字裡的網址變成可點擊的 <a>，其餘文字照常逸出', () => {
  const html = linkifyHtml('請看 https://example.com/a?x=1&y=2 這份文件')
  assert.ok(html.includes('<a href="https://example.com/a?x=1&amp;y=2" target="_blank" rel="noreferrer"'))
  assert.ok(html.includes('請看 '))
  assert.ok(html.includes(' 這份文件'))
})

test('linkifyHtml：沒有網址的純文字維持原樣(只是照常 escapeHtml)', () => {
  assert.equal(linkifyHtml('普通文字 <b>粗體</b>'), '普通文字 &lt;b&gt;粗體&lt;/b&gt;')
})

test('linkifyHtml：只認 http(s):// 開頭，javascript:/data: 不會被當成連結', () => {
  const html = linkifyHtml('javascript:alert(1) 和 data:text/html,x 都只是文字')
  assert.ok(!html.includes('<a href'))
})

test('linkifyHtml：多個網址都各自變成連結', () => {
  const html = linkifyHtml('第一個 https://a.com 第二個 https://b.com')
  assert.equal((html.match(/<a href/g) || []).length, 2)
})

test('buildHtml：需求簡述裡的網址會變成可點擊連結', () => {
  const html = buildHtml({ projectName: 'x', description: '參考 https://example.com/spec 這份規格' })
  assert.ok(html.includes('<a href="https://example.com/spec" target="_blank"'))
})

test('buildHtml：需求簡述有 HTML 特殊字元時，網址外的部分仍然逸出(不會被注入標籤)', () => {
  const html = buildHtml({ projectName: 'x', description: '<script>alert(1)</script> https://example.com' })
  assert.ok(!html.includes('<script>alert(1)</script>'))
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(html.includes('<a href="https://example.com" target="_blank"'))
})

test('buildHtml：所有文字元素都明寫微軟正黑體字型，不是只放在最外層靠繼承', () => {
  const html = buildHtml({
    projectName: 'x', attachments: [{ name: 'a.pdf', url: 'https://firebasestorage.googleapis.com/v0/b/team-scheduler-dc7ce.firebasestorage.app/o/attachments%2Fr1%2Fa.pdf?alt=media&token=t' }],
  }, 'r1')
  const styledTags = html.match(/<(h2|p|table|td|a|span)\b[^>]*style="[^"]*"/g) || []
  assert.ok(styledTags.length > 0, '應該至少有一些帶 style 的文字元素可供檢查')
  for (const tag of styledTags) {
    assert.ok(tag.includes("font-family:'Microsoft JhengHei'"), `每個文字元素都應明寫微軟正黑體字型: ${tag}`)
  }
})

test('buildHtml：所有 font-size 都不小於 12px', () => {
  const html = buildHtml({ projectName: 'x' })
  const sizes = [...html.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]))
  assert.ok(sizes.length > 0)
  for (const size of sizes) assert.ok(size >= 12, `font-size 不應小於 12px，實際是 ${size}px`)
})

test('buildHtml：結尾會附上創見 logo(固定路徑的圖檔，不是會變動的 hash 路徑)', () => {
  const html = buildHtml({ projectName: 'x' })
  assert.ok(html.includes('<img src="https://transcend-design.web.app/transcend-logo.svg"'))
  assert.ok(html.includes('alt="Transcend"'))
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

test('buildHtml：指派設計師署名，多位設計師用頓號連接', () => {
  const html = buildHtml({
    projectName: 'x',
    assignedDesigners: ['sherry@example.com', 'tingwei@example.com'],
    assignedDesignersNames: ['Sherry', 'Tingwei'],
  })
  assert.ok(html.includes('指派設計師'))
  assert.ok(html.includes('Sherry、Tingwei'))
})

test('buildHtml：沒有 assignedDesignersNames 時退回顯示 email', () => {
  const html = buildHtml({ projectName: 'x', assignedDesigners: ['sherry@example.com'] })
  assert.ok(html.includes('sherry@example.com'))
})

test('buildHtml：完全沒有指派設計師時顯示「尚未指派」，不會是空白或 undefined', () => {
  const html = buildHtml({ projectName: 'x' })
  assert.ok(html.includes('指派設計師'))
  assert.ok(html.includes('（尚未指派）'))
  assert.ok(!html.includes('undefined'))
})

test('buildHtml：設計師姓名裡的 HTML 特殊字元會被逸出，不會被注入標籤', () => {
  const html = buildHtml({
    projectName: 'x',
    assignedDesigners: ['a@example.com'],
    assignedDesignersNames: ['<img src=x onerror=alert(1)>'],
  })
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'))
  assert.ok(html.includes('&lt;img'))
})

test('buildHtml 合法的 Firebase Storage 附件網址(屬於目前 requestId)會被列成連結，檔名同樣逸出特殊字元', () => {
  const html = buildHtml({
    projectName: 'x',
    attachments: [{ name: '<img src=x onerror=alert(1)>.pdf', url: LEGIT_URL }],
  }, REQUEST_ID)
  // href 屬性值裡的 & 依 HTML 規則要逸出成 &amp;，所以比對時用逸出過的形式
  assert.ok(html.includes(`href="${LEGIT_URL.replace(/&/g, '&amp;')}"`))
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'))
  assert.ok(html.includes('&lt;img'))
})

test('buildHtml 對不合法的附件網址不會產生 <a> 連結，只顯示純文字(且檔名仍逸出)', () => {
  const html = buildHtml({
    projectName: 'x',
    attachments: [{ name: '假附件.pdf', url: 'https://example.com/f.pdf' }],
  }, REQUEST_ID)
  assert.ok(!html.includes('<a href="https://example.com/f.pdf"'))
  assert.ok(html.includes('假附件.pdf'))
  assert.ok(html.includes('連結無效'))
})

// ── requestId 綁定驗證(buildHtml 第二個參數) ──────────────────────────────
test('buildHtml：附件網址屬於目前這封信的 requestId → 產生連結', () => {
  const html = buildHtml({
    projectName: 'x',
    attachments: [{ name: 'a.pdf', url: LEGIT_URL }],
  }, REQUEST_ID)
  assert.ok(html.includes(`href="${LEGIT_URL.replace(/&/g, '&amp;')}"`))
})

test('buildHtml：附件網址指向「另一個」requestId → 不產生連結，只顯示純文字', () => {
  const html = buildHtml({
    projectName: 'x',
    attachments: [{ name: 'a.pdf', url: LEGIT_URL }],
  }, 'some-other-request-id')
  assert.ok(!html.includes(`href="${LEGIT_URL.replace(/&/g, '&amp;')}"`))
  assert.ok(html.includes('連結無效'))
})

test('buildHtml：storagePath 跟 url 解出的路徑不一致(URL 合法但 storagePath 被竄改指向別筆需求)→ 不產生連結', () => {
  const html = buildHtml({
    projectName: 'x',
    attachments: [{ name: 'a.pdf', url: LEGIT_URL, storagePath: 'attachments/some-other-request-id/file-abc.pdf' }],
  }, REQUEST_ID)
  assert.ok(!html.includes(`href="${LEGIT_URL.replace(/&/g, '&amp;')}"`))
  assert.ok(html.includes('連結無效'))
})

test('buildHtml：舊資料(沒有 storagePath 欄位)但 url 精確屬於目前 requestId → 仍可產生連結', () => {
  const html = buildHtml({
    projectName: 'x',
    attachments: [{ name: 'a.pdf', url: LEGIT_URL }], // 沒有 storagePath，模擬舊資料
  }, REQUEST_ID)
  assert.ok(html.includes(`href="${LEGIT_URL.replace(/&/g, '&amp;')}"`))
})

test('buildHtml：storagePath 跟 url 解出的路徑一致且都屬於目前 requestId → 產生連結', () => {
  const html = buildHtml({
    projectName: 'x',
    attachments: [{ name: 'a.pdf', url: LEGIT_URL, storagePath: 'attachments/req123/file-abc.pdf' }],
  }, REQUEST_ID)
  assert.ok(html.includes(`href="${LEGIT_URL.replace(/&/g, '&amp;')}"`))
})

test('buildHtml：malformed/external/javascript:/data: 附件網址一律不產生連結，即使 requestId 對得上', () => {
  // 底部一定會有「前往需求總表」這顆固定的 <a href>按鈕，跟附件連結無關 —— 這裡只驗證
  // 「附件連結數」沒有因為這顆按鈕而被誤判，改成跟 baseline(完全沒有附件時的 <a href> 數量)比較。
  const baselineHrefCount = (buildHtml({ projectName: 'x' }, REQUEST_ID).match(/<a href=/g) || []).length
  const badUrls = [
    'not a url',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://example.com/attachments/req123/file-abc.pdf', // 外部網域，非 Firebase Storage
    LEGIT_URL.replace('https://', 'http://'), // 非 https
  ]
  for (const url of badUrls) {
    const html = buildHtml({ projectName: 'x', attachments: [{ name: 'a.pdf', url }] }, REQUEST_ID)
    const hrefCount = (html.match(/<a href=/g) || []).length
    assert.equal(hrefCount, baselineHrefCount, `不應該對 ${url} 額外產生附件連結`)
    assert.ok(html.includes('連結無效'), `${url} 應該顯示連結無效`)
  }
})

test('safeAttachmentUrlForRequest：直接單元測試(不透過 buildHtml)——requestId 相符才回傳網址', () => {
  assert.equal(safeAttachmentUrlForRequest({ name: 'a.pdf', url: LEGIT_URL }, REQUEST_ID), LEGIT_URL)
  assert.equal(safeAttachmentUrlForRequest({ name: 'a.pdf', url: LEGIT_URL }, 'other-id'), null)
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
  // 用正確的 REQUEST_ID，確保這筆附件真的會走到產生 href 的路徑(否則這個測試即使
  // href-escaping 邏輯本身有問題，也會因為根本沒產生連結而誤判通過)
  const html = buildHtml({
    projectName: 'x',
    attachments: [{ name: 'a.pdf', url: `${LEGIT_URL}" onerror="alert(1)` }],
  }, REQUEST_ID)
  assert.ok(html.includes('<a href='), '這個附件的路徑仍精確屬於 REQUEST_ID，應該要產生連結才能驗證跳脫邏輯')
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
