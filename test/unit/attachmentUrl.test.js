import { describe, it, expect } from 'vitest'
import { getSafeAttachmentUrl } from '../../src/utils/attachmentUrl.js'

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
