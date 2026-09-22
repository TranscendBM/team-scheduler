import { describe, it, expect } from 'vitest'
import { lockScroll, unlockScroll, scrollLockCount, SCROLL_LOCK_CLASS } from '../../src/utils/scrollLock.js'

// 用假的 document（不需要 jsdom）驗證「開→關一定會完全還原」，
// 以及多層 Modal/drawer 疊加時不會提早解鎖。
function fakeDoc({ innerWidth = 1024, clientWidth = 1024 } = {}) {
  const classes = new Set()
  return {
    defaultView: { innerWidth },
    documentElement: { clientWidth },
    body: {
      dataset: {},
      style: { paddingRight: '' },
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
      },
    },
    _classes: classes,
  }
}

describe('scrollLock', () => {
  it('lock 之後 body 會帶上鎖定 class，unlock 之後完全移除', () => {
    const doc = fakeDoc()
    lockScroll(doc)
    expect(doc.body.classList.contains(SCROLL_LOCK_CLASS)).toBe(true)
    unlockScroll(doc)
    expect(doc.body.classList.contains(SCROLL_LOCK_CLASS)).toBe(false)
    expect(scrollLockCount(doc)).toBe(0)
  })

  it('有捲軸時會補上 padding-right，解鎖後還原成原本的值（不殘留）', () => {
    const doc = fakeDoc({ innerWidth: 1024, clientWidth: 1009 }) // 15px 捲軸
    doc.body.style.paddingRight = '8px'
    lockScroll(doc)
    expect(doc.body.style.paddingRight).toBe('15px')
    unlockScroll(doc)
    expect(doc.body.style.paddingRight).toBe('8px')
    expect(doc.body.dataset.tsScrollLockPad).toBeUndefined()
  })

  it('兩層同時鎖住時，關掉其中一層不會提早解鎖（drawer 開著又開 Modal 的情境）', () => {
    const doc = fakeDoc()
    lockScroll(doc)
    lockScroll(doc)
    expect(scrollLockCount(doc)).toBe(2)
    unlockScroll(doc)
    expect(doc.body.classList.contains(SCROLL_LOCK_CLASS)).toBe(true)
    unlockScroll(doc)
    expect(doc.body.classList.contains(SCROLL_LOCK_CLASS)).toBe(false)
  })

  it('重複 unlock 不會把計數變成負數，也不會噴錯', () => {
    const doc = fakeDoc()
    unlockScroll(doc)
    unlockScroll(doc)
    expect(scrollLockCount(doc)).toBe(0)
  })
})
