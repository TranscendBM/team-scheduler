import { describe, it, expect } from 'vitest'
import { getSafeAttachmentUrl, resolveSafeAttachmentPath } from '../../src/utils/attachmentUrl.js'

const BUCKET = 'team-scheduler-dc7ce.firebasestorage.app'
const REQUEST_ID = 'req-abc123'
const urlFor = (path, token = 'abc123') =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${token}`

describe('getSafeAttachmentUrl', () => {
  it('合法的本專案 Firebase Storage URL、綁定正確 requestId 成功', () => {
    const path = `attachments/${REQUEST_ID}/file-123.pdf`
    const att = { url: urlFor(path), storagePath: path }
    expect(getSafeAttachmentUrl(att, REQUEST_ID)).toBe(urlFor(path))
  })

  it('舊附件沒有 storagePath 時，仍可依經過驗證的 URL 使用，但一樣要綁定目前 requestId', () => {
    const path = `attachments/${REQUEST_ID}/legacy-file.pdf`
    const att = { url: urlFor(path) } // 沒有 storagePath 欄位
    expect(getSafeAttachmentUrl(att, REQUEST_ID)).toBe(urlFor(path))
  })

  it('javascript: 偽造網址被拒', () => {
    const att = { url: 'javascript:alert(document.cookie)' }
    expect(getSafeAttachmentUrl(att, REQUEST_ID)).toBe(null)
  })

  it('data: URI 被拒', () => {
    const att = { url: 'data:text/html,<script>alert(1)</script>' }
    expect(getSafeAttachmentUrl(att, REQUEST_ID)).toBe(null)
  })

  it('外部 HTTPS 網址(非 Firebase Storage host)被拒', () => {
    const att = { url: 'https://evil.example.com/phishing' }
    expect(getSafeAttachmentUrl(att, REQUEST_ID)).toBe(null)
  })

  it('bucket 不是本專案的 bucket 會被拒', () => {
    const path = `attachments/${REQUEST_ID}/a.pdf`
    const wrongBucketUrl = `https://firebasestorage.googleapis.com/v0/b/some-other-project.appspot.com/o/${encodeURIComponent(path)}?alt=media&token=abc`
    const att = { url: wrongBucketUrl }
    expect(getSafeAttachmentUrl(att, REQUEST_ID)).toBe(null)
  })

  it('URL 指向另一個 requestId 的附件被拒(用這筆 request 的身分讀別筆附件)', () => {
    const path = 'attachments/some-other-request/a.pdf'
    const att = { url: urlFor(path) }
    expect(getSafeAttachmentUrl(att, REQUEST_ID)).toBe(null)
  })

  it('storagePath 與 URL 解出的路徑不一致被拒(即使兩者單獨看都合法)', () => {
    const urlPath = `attachments/${REQUEST_ID}/real-file.pdf`
    const att = { url: urlFor(urlPath), storagePath: `attachments/${REQUEST_ID}/different-file.pdf` }
    expect(getSafeAttachmentUrl(att, REQUEST_ID)).toBe(null)
  })

  it('storagePath 指向另一個 requestId 被拒(即使 URL 解出的路徑跟 storagePath 一致)', () => {
    const path = 'attachments/some-other-request/a.pdf'
    const att = { url: urlFor(path), storagePath: path }
    expect(getSafeAttachmentUrl(att, REQUEST_ID)).toBe(null)
  })

  it('encode 過的 path traversal(多一層目錄)被拒', () => {
    const traversalPath = `attachments/${REQUEST_ID}/../other-request/a.pdf`
    const att = { url: urlFor(traversalPath) }
    expect(getSafeAttachmentUrl(att, REQUEST_ID)).toBe(null)
  })

  it('多一層子目錄(非 traversal，單純多一段路徑)被拒', () => {
    const path = `attachments/${REQUEST_ID}/sub/a.pdf`
    const att = { url: urlFor(path) }
    expect(getSafeAttachmentUrl(att, REQUEST_ID)).toBe(null)
  })

  it('malformed URL 安全回傳 null，不會噴錯', () => {
    expect(getSafeAttachmentUrl({ url: 'not a url at all' }, REQUEST_ID)).toBe(null)
    expect(getSafeAttachmentUrl({ url: '' }, REQUEST_ID)).toBe(null)
    expect(getSafeAttachmentUrl({ url: undefined }, REQUEST_ID)).toBe(null)
    expect(getSafeAttachmentUrl(null, REQUEST_ID)).toBe(null)
    expect(getSafeAttachmentUrl(undefined, REQUEST_ID)).toBe(null)
  })

  it('http(非 https)被拒', () => {
    const path = `attachments/${REQUEST_ID}/a.pdf`
    const httpUrl = `http://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=abc`
    expect(getSafeAttachmentUrl({ url: httpUrl }, REQUEST_ID)).toBe(null)
  })

  it('沒有傳入 requestId(例如尚未建立的需求)一律拒絕，不因為缺少比對對象就放行', () => {
    const path = `attachments/${REQUEST_ID}/a.pdf`
    const att = { url: urlFor(path) }
    expect(getSafeAttachmentUrl(att, undefined)).toBe(null)
    expect(getSafeAttachmentUrl(att, '')).toBe(null)
  })
})

// resolveSafeAttachmentPath 是 deleteAttachmentFiles() 決定「實際要刪哪個 Storage 物件」用的
// resolver，回傳的是路徑(不是網址)，跟 getSafeAttachmentUrl 共用同一套驗證鏈 —— 這裡不重複跑
// 完整的驗證矩陣(上面 getSafeAttachmentUrl 的測試已經涵蓋)，只驗證「回傳值是路徑」跟幾個
// PR 明確要求要涵蓋的關鍵情境(正常 URL+相同 storagePath 可刪、舊附件沒有 storagePath 仍可刪、
// 以及會導致 confused-deputy 的跨 request 情境)。
describe('resolveSafeAttachmentPath', () => {
  it('正常 URL + 相同 storagePath：回傳可以刪除的 Storage 路徑', () => {
    const path = `attachments/${REQUEST_ID}/file-123.pdf`
    const att = { url: urlFor(path), storagePath: path }
    expect(resolveSafeAttachmentPath(att, REQUEST_ID)).toBe(path)
  })

  it('舊附件沒有 storagePath：仍可依經過驗證的 URL 解出路徑刪除，但一樣要綁定目前 requestId', () => {
    const path = `attachments/${REQUEST_ID}/legacy-file.pdf`
    const att = { url: urlFor(path) } // 沒有 storagePath 欄位
    expect(resolveSafeAttachmentPath(att, REQUEST_ID)).toBe(path)
  })

  it('storagePath 與 URL 解出的路徑不一致：拒絕，不回傳任何路徑(不能刪)', () => {
    const urlPath = `attachments/${REQUEST_ID}/real-file.pdf`
    const att = { url: urlFor(urlPath), storagePath: `attachments/${REQUEST_ID}/different-file.pdf` }
    expect(resolveSafeAttachmentPath(att, REQUEST_ID)).toBe(null)
  })

  it('storagePath 指向另一個 requestId：拒絕(confused-deputy 情境 —— manager 對著 A 這筆 request 操作，storagePath 卻壞掉/被竄改成指向 B，絕不能因此刪到 B 的檔案)', () => {
    const otherPath = 'attachments/some-other-request/a.pdf'
    const att = { url: urlFor(otherPath), storagePath: otherPath }
    expect(resolveSafeAttachmentPath(att, REQUEST_ID)).toBe(null)
  })

  it('URL 本身就指向另一個 requestId(沒有 storagePath)：一樣拒絕', () => {
    const att = { url: urlFor('attachments/some-other-request/a.pdf') }
    expect(resolveSafeAttachmentPath(att, REQUEST_ID)).toBe(null)
  })

  it('多一層子目錄：拒絕(不是合法的 attachments/{requestId}/{檔名} 結構)', () => {
    const att = { url: urlFor(`attachments/${REQUEST_ID}/sub/a.pdf`) }
    expect(resolveSafeAttachmentPath(att, REQUEST_ID)).toBe(null)
  })

  it('malformed URL 安全回傳 null，不會噴錯', () => {
    expect(resolveSafeAttachmentPath({ url: 'not a url at all' }, REQUEST_ID)).toBe(null)
    expect(resolveSafeAttachmentPath({ url: '' }, REQUEST_ID)).toBe(null)
    expect(resolveSafeAttachmentPath(null, REQUEST_ID)).toBe(null)
    expect(resolveSafeAttachmentPath(undefined, REQUEST_ID)).toBe(null)
  })

  it('javascript:/data: 偽造網址被拒(不會被拿去當成任何路徑刪除)', () => {
    expect(resolveSafeAttachmentPath({ url: 'javascript:alert(1)' }, REQUEST_ID)).toBe(null)
    expect(resolveSafeAttachmentPath({ url: 'data:text/html,x' }, REQUEST_ID)).toBe(null)
  })

  it('沒有傳入 requestId 一律拒絕', () => {
    const att = { url: urlFor(`attachments/${REQUEST_ID}/a.pdf`) }
    expect(resolveSafeAttachmentPath(att, undefined)).toBe(null)
    expect(resolveSafeAttachmentPath(att, '')).toBe(null)
  })
})
