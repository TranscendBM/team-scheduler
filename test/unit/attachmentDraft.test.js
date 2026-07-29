import { describe, it, expect, vi } from 'vitest'
import {
  attachmentKey, markRemoved, unmarkRemoved, keptAttachments, removedAttachments, commitWithDeferredDeletion,
} from '../../src/utils/attachmentDraft.js'

const A = { name: 'a.pdf', url: 'https://x/a', storagePath: 'attachments/r1/a-123.pdf', size: 100 }
const B = { name: 'b.pdf', url: 'https://x/b', storagePath: 'attachments/r1/b-456.pdf', size: 200 }
// 同名但 storagePath 不同(同一份需求裡先刪過一次同名檔案又重新上傳，安全檔名帶時間戳所以路徑不同)
const A2 = { name: 'a.pdf', url: 'https://x/a2', storagePath: 'attachments/r1/a-789.pdf', size: 150 }

describe('attachmentKey', () => {
  it('優先用 storagePath 當識別值', () => {
    expect(attachmentKey(A)).toBe('attachments/r1/a-123.pdf')
  })
  it('沒有 storagePath 時退回 url', () => {
    expect(attachmentKey({ name: 'x', url: 'https://x/legacy' })).toBe('https://x/legacy')
  })
})

describe('markRemoved / unmarkRemoved — 移除後取消(復原)', () => {
  it('標記移除後，該附件的 key 會出現在 removedKeys', () => {
    const removed = markRemoved([], A)
    expect(removed).toEqual([attachmentKey(A)])
  })

  it('重複標記同一個附件不會產生重複 key', () => {
    const removed = markRemoved(markRemoved([], A), A)
    expect(removed).toEqual([attachmentKey(A)])
  })

  it('使用者反悔按「復原」：unmarkRemoved 後 removedKeys 不再包含它，等於「取消移除」', () => {
    const removed = markRemoved([], A)
    const restored = unmarkRemoved(removed, A)
    expect(restored).toEqual([])
    expect(keptAttachments([A, B], restored)).toEqual([A, B]) // 復原後跟原本一樣，兩個都保留
  })

  it('復原不影響其他已標記移除的附件', () => {
    const removed = markRemoved(markRemoved([], A), B)
    const afterRestoreA = unmarkRemoved(removed, A)
    expect(afterRestoreA).toEqual([attachmentKey(B)])
  })
})

describe('keptAttachments / removedAttachments', () => {
  it('沒有任何移除標記時，全部保留、沒有要刪除的', () => {
    expect(keptAttachments([A, B], [])).toEqual([A, B])
    expect(removedAttachments([A, B], [])).toEqual([])
  })

  it('標記移除 A 後：保留清單只剩 B，待刪清單只有 A', () => {
    const removed = markRemoved([], A)
    expect(keptAttachments([A, B], removed)).toEqual([B])
    expect(removedAttachments([A, B], removed)).toEqual([A])
  })

  it('同名附件(name 相同、storagePath 不同)：只移除使用者實際點的那一個，另一個同名的不受影響', () => {
    const removed = markRemoved([], A) // 標記移除舊的 a.pdf(storagePath=a-123)
    const kept = keptAttachments([A, A2, B], removed)
    // A2 檔名也叫 a.pdf，但 storagePath 不同，不應該被誤刪
    expect(kept).toEqual([A2, B])
    expect(removedAttachments([A, A2, B], removed)).toEqual([A])
  })
})

describe('commitWithDeferredDeletion — Firestore 寫入與刪檔的順序保證', () => {
  it('Firestore 更新失敗時，刪檔函式完全不會被呼叫(不得刪除舊附件)', async () => {
    const writeFn = vi.fn().mockRejectedValue(new Error('permission-denied'))
    const deleteFn = vi.fn().mockResolvedValue(undefined)
    await expect(commitWithDeferredDeletion(writeFn, deleteFn)).rejects.toThrow('permission-denied')
    expect(writeFn).toHaveBeenCalledTimes(1)
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it('Firestore 更新成功後，刪檔函式會被呼叫恰好一次', async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined)
    const deleteFn = vi.fn().mockResolvedValue(undefined)
    await commitWithDeferredDeletion(writeFn, deleteFn)
    expect(writeFn).toHaveBeenCalledTimes(1)
    expect(deleteFn).toHaveBeenCalledTimes(1)
  })

  it('呼叫順序固定是「先 write 後 delete」，不會顛倒', async () => {
    const order = []
    const writeFn = vi.fn().mockImplementation(async () => { order.push('write') })
    const deleteFn = vi.fn().mockImplementation(async () => { order.push('delete') })
    await commitWithDeferredDeletion(writeFn, deleteFn)
    expect(order).toEqual(['write', 'delete'])
  })
})
