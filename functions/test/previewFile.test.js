// 純函式測試，不連任何 Firebase 服務。涵蓋 previewFile 用來決定「這個附件實際能不能讀」的核心邏輯
// (resolveAttachmentPath)，確保合法 token URL 搭配指向別的物件的 storagePath 不能被拿來越權讀取；
// 也涵蓋 proxy token 驗證(isValidPreviewToken)，確保不能用 startsWith 式的短前綴猜測矇混過關。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveAttachmentPath, parseAttachmentStoragePath, isAttachmentPathForRequest,
  extractDownloadToken, isValidPreviewToken,
} from '../index.js'

const BUCKET = 'team-scheduler-dc7ce.firebasestorage.app'
const urlFor = (path, token = 'abc') => `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${token}`

test('合法 URL + 相同 storagePath 通過', () => {
  const path = 'attachments/docA/file-123.pdf'
  const att = { url: urlFor(path), storagePath: path }
  assert.equal(resolveAttachmentPath(att, 'docA'), path)
})

test('沒有 storagePath 的舊合法附件仍可使用(退回用已驗證 URL 解出的路徑)', () => {
  const path = 'attachments/docA/legacy-file.pdf'
  const att = { url: urlFor(path) } // 沒有 storagePath 欄位
  assert.equal(resolveAttachmentPath(att, 'docA'), path)
})

test('URL path 與 storagePath 不同被拒(即使兩者都指向同一個 docId，只要不完全一致就不信任)', () => {
  const att = { url: urlFor('attachments/docA/real-file.pdf'), storagePath: 'attachments/docA/different-file.pdf' }
  assert.equal(resolveAttachmentPath(att, 'docA'), null)
})

test('storagePath 指向另一個 request 被拒(storagePath 跟 url 解出的路徑一致，但都不屬於要讀的 docId)', () => {
  const otherPath = 'attachments/docB/file.pdf'
  const att = { url: urlFor(otherPath), storagePath: otherPath }
  assert.equal(resolveAttachmentPath(att, 'docA'), null) // 用 docA 的 token 想讀 docB 的附件
})

test('URL 指向另一個 request 被拒(沒有 storagePath，單純 URL 本身指到別筆需求)', () => {
  const att = { url: urlFor('attachments/docB/file.pdf') }
  assert.equal(resolveAttachmentPath(att, 'docA'), null)
})

test('malformed URL 回傳安全的 null，不會噴錯(不對 .match(...)[1] 直接取值)', () => {
  assert.doesNotThrow(() => resolveAttachmentPath({ url: 'not a url' }, 'docA'))
  assert.equal(resolveAttachmentPath({ url: 'not a url' }, 'docA'), null)
  assert.doesNotThrow(() => resolveAttachmentPath({ url: undefined }, 'docA'))
  assert.equal(resolveAttachmentPath({ url: undefined }, 'docA'), null)
  assert.doesNotThrow(() => resolveAttachmentPath(null, 'docA'))
  assert.equal(resolveAttachmentPath(null, 'docA'), null)
})

test('javascript:/data: 等偽造 URL 一律回傳 null', () => {
  assert.equal(resolveAttachmentPath({ url: 'javascript:alert(1)', storagePath: 'attachments/docA/x.pdf' }, 'docA'), null)
  assert.equal(resolveAttachmentPath({ url: 'data:text/html,x', storagePath: 'attachments/docA/x.pdf' }, 'docA'), null)
})

test('parseAttachmentStoragePath：合法網址解出正確路徑，不合法回傳 null 不噴錯', () => {
  const path = 'attachments/docA/f.pdf'
  assert.equal(parseAttachmentStoragePath(urlFor(path)), path)
  assert.equal(parseAttachmentStoragePath('not a url'), null)
  assert.equal(parseAttachmentStoragePath(undefined), null)
})

test('isAttachmentPathForRequest：只接受精確符合 attachments/{docId}/{檔名} 的路徑，不是 startsWith', () => {
  assert.equal(isAttachmentPathForRequest('attachments/docA/f.pdf', 'docA'), true)
  assert.equal(isAttachmentPathForRequest('attachments/docA-evil/f.pdf', 'docA'), false) // startsWith('attachments/docA') 會誤放，精確比對才會擋
  assert.equal(isAttachmentPathForRequest('attachments/docA/sub/f.pdf', 'docA'), false) // 多一層路徑
  assert.equal(isAttachmentPathForRequest('secrets/docA/f.pdf', 'docA'), false)
  assert.equal(isAttachmentPathForRequest('', 'docA'), false)
  assert.equal(isAttachmentPathForRequest('attachments/docA/f.pdf', ''), false)
})

// previewFile 是公開 endpoint，proxy token 驗證不能用 startsWith 前綴比對 —— 那樣攻擊者只要送 1 個字元，
// 只要那個字元剛好對就會通過，等於把安全性降到猜對 1 碼(base64url 字元集，機率遠高於猜對完整 12 碼)。
const FULL_TOKEN = 'a1b2c3d4-e5f6-47a8-9b0c-d1e2f3a4b5c6' // 模擬 Firebase Storage 下載 token 的格式(UUID)
const CORRECT_12 = FULL_TOKEN.slice(0, 12) // 'a1b2c3d4-e5f'

test('isValidPreviewToken：合法 12 字元(完整 token 的前 12 碼)通過', () => {
  assert.equal(isValidPreviewToken(FULL_TOKEN, CORRECT_12), true)
})

test('isValidPreviewToken：攻擊者只猜對 1 個字元被拒(長度不是 12，格式檢查就先擋掉，不會落入前綴比對)', () => {
  assert.equal(isValidPreviewToken(FULL_TOKEN, FULL_TOKEN[0]), false)
  assert.equal(isValidPreviewToken(FULL_TOKEN, 'a'), false)
})

test('isValidPreviewToken：11 碼(比正確前綴少一碼，即使内容完全正確)被拒', () => {
  assert.equal(isValidPreviewToken(FULL_TOKEN, CORRECT_12.slice(0, 11)), false)
})

test('isValidPreviewToken：13 碼(比正確前綴多一碼)被拒 —— 不接受任何長度的 prefix', () => {
  assert.equal(isValidPreviewToken(FULL_TOKEN, FULL_TOKEN.slice(0, 13)), false)
})

test('isValidPreviewToken：12 碼但內容跟真正的前 12 碼不同被拒', () => {
  assert.equal(isValidPreviewToken(FULL_TOKEN, 'zzzzzzzzzzzz'), false)
})

test('isValidPreviewToken：fullToken 是 malformed(null/非字串)時安全回傳 false，不噴錯', () => {
  assert.doesNotThrow(() => isValidPreviewToken(null, CORRECT_12))
  assert.equal(isValidPreviewToken(null, CORRECT_12), false)
  assert.equal(isValidPreviewToken(undefined, CORRECT_12), false)
})

test('extractDownloadToken：合法網址能解出正確的完整 token', () => {
  assert.equal(extractDownloadToken(urlFor('attachments/docA/f.pdf', FULL_TOKEN)), FULL_TOKEN)
})

test('extractDownloadToken：malformed URL 回傳 null，不會噴錯', () => {
  assert.doesNotThrow(() => extractDownloadToken('not a url'))
  assert.equal(extractDownloadToken('not a url'), null)
  assert.equal(extractDownloadToken(undefined), null)
})

test('extractDownloadToken：合法網址但缺少 token 參數回傳 null', () => {
  const noToken = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent('attachments/docA/f.pdf')}?alt=media`
  assert.equal(extractDownloadToken(noToken), null)
})

test('整合情境：previewFile 實際用的判斷順序 —— extractDownloadToken + isValidPreviewToken 兩者串起來', () => {
  const url = urlFor('attachments/docA/f.pdf', FULL_TOKEN)
  assert.equal(isValidPreviewToken(extractDownloadToken(url), CORRECT_12), true)
  assert.equal(isValidPreviewToken(extractDownloadToken(url), FULL_TOKEN[0]), false)
  assert.equal(isValidPreviewToken(extractDownloadToken('not a url'), CORRECT_12), false)
})
