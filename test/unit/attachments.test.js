import { describe, expect, it } from 'vitest'
import { getAttachmentPreviewInfo } from '../../src/components/Attachments.jsx'

const SAFE_URL = 'https://firebasestorage.googleapis.com/v0/b/team-scheduler-dc7ce.firebasestorage.app/o/attachments%2Freq-1%2Fdeck.pptx?alt=media&token=1234567890123456'

describe('getAttachmentPreviewInfo', () => {
  it.each(['deck.ppt', 'deck.pptx', 'DECK.PPTX'])(
    'uses the local browser renderer for %s',
    name => {
      expect(getAttachmentPreviewInfo({ name }, SAFE_URL, 'req-1', 0)).toEqual({
        kind: 'powerpoint',
        src: SAFE_URL,
      })
    },
  )

  it('keeps Word documents on the Office viewer path', () => {
    const info = getAttachmentPreviewInfo({ name: 'brief.docx' }, SAFE_URL, 'req-1', 0)
    expect(info.kind).toBe('iframe')
    expect(info.src).toContain('view.officeapps.live.com')
  })
})
