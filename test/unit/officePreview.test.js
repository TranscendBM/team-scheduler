import { describe, expect, it } from 'vitest'
import { buildOfficeProxyUrl, buildOfficeViewerUrl } from '../../src/utils/officePreview.js'

const URL = 'https://firebasestorage.googleapis.com/v0/b/team-scheduler-dc7ce.firebasestorage.app/o/attachments%2Freq1%2Fdeck.pptx?alt=media&token=123456789012-rest-of-token'

describe('Office attachment preview URLs', () => {
  it('代理網址包含 token 前 12 碼與原始副檔名，讓 Office 能辨識格式', () => {
    expect(buildOfficeProxyUrl(URL, 'req1', 2, '簡報.pptx')).toBe(
      'https://asia-east1-team-scheduler-dc7ce.cloudfunctions.net/previewFile/req1/2/123456789012/file.pptx',
    )
  })

  it('iframe 使用 embed endpoint，不使用適合另開頁面的 view endpoint', () => {
    const viewer = buildOfficeViewerUrl(URL, 'req1', 2, '簡報.pptx')
    expect(viewer).toContain('https://view.officeapps.live.com/op/embed.aspx?src=')
    expect(decodeURIComponent(viewer)).toContain('/file.pptx')
    expect(viewer).not.toContain('/op/view.aspx')
  })

  it('缺少 token、requestId 或 index 不合法時拒絕建立公開代理網址', () => {
    expect(buildOfficeProxyUrl(URL.replace(/&token=.*/, ''), 'req1', 0, 'x.pptx')).toBeNull()
    expect(buildOfficeProxyUrl(URL, '', 0, 'x.pptx')).toBeNull()
    expect(buildOfficeProxyUrl(URL, 'req1', -1, 'x.pptx')).toBeNull()
  })
})
