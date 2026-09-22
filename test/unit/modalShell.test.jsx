// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModalShell from '../../src/components/ui/ModalShell.jsx'
import ConfirmDialog from '../../src/components/ui/ConfirmDialog.jsx'
import { SCROLL_LOCK_CLASS } from '../../src/utils/scrollLock.js'

afterEach(() => {
  cleanup()
  document.body.classList.remove(SCROLL_LOCK_CLASS)
})

describe('ModalShell', () => {
  it('有 dialog 語意與可讀的關閉按鈕（icon-only 也要有 aria-label）', () => {
    render(<ModalShell title="編輯秀展" onClose={() => {}}>內容</ModalShell>)
    const dialog = screen.getByRole('dialog', { name: '編輯秀展' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('button', { name: '關閉' })).toBeTruthy()
  })

  it('開啟時鎖住背景捲動，卸載後一定解除（route 切換不殘留 scroll lock）', () => {
    const { unmount } = render(<ModalShell title="X" onClose={() => {}}>內容</ModalShell>)
    expect(document.body.classList.contains(SCROLL_LOCK_CLASS)).toBe(true)
    unmount()
    expect(document.body.classList.contains(SCROLL_LOCK_CLASS)).toBe(false)
  })

  it('Escape 會呼叫 onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<ModalShell title="X" onClose={onClose}>內容</ModalShell>)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('點 backdrop 會呼叫 onClose，點內容區不會', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    const { container } = render(<ModalShell title="X" onClose={onClose}><p>內容</p></ModalShell>)
    await user.click(screen.getByText('內容'))
    expect(onClose).not.toHaveBeenCalled()
    await user.click(container.firstChild)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('dismissible=false 時（破壞性確認）backdrop 與 Escape 都不會關閉', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    const { container } = render(<ModalShell title="X" onClose={onClose} dismissible={false}>內容</ModalShell>)
    await user.keyboard('{Escape}')
    await user.click(container.firstChild)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('兩層 Modal 疊加時，關掉上層不會提早解除背景捲動鎖', () => {
    const outer = render(<ModalShell title="外層" onClose={() => {}}>外</ModalShell>)
    const inner = render(<ModalShell title="內層" onClose={() => {}}>內</ModalShell>)
    expect(document.body.classList.contains(SCROLL_LOCK_CLASS)).toBe(true)
    inner.unmount()
    expect(document.body.classList.contains(SCROLL_LOCK_CLASS)).toBe(true)
    outer.unmount()
    expect(document.body.classList.contains(SCROLL_LOCK_CLASS)).toBe(false)
  })
})

describe('ConfirmDialog（破壞性確認）', () => {
  it('backdrop 與 Escape 都不會誤關，只能按取消或確認', async () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    const { container } = render(
      <ConfirmDialog message="確定要刪除嗎？" onCancel={onCancel} onConfirm={onConfirm} />,
    )
    await user.keyboard('{Escape}')
    await user.click(container.firstChild)
    expect(onCancel).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '刪除' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('卸載後解除背景捲動鎖', () => {
    const { unmount } = render(<ConfirmDialog message="x" onCancel={() => {}} onConfirm={() => {}} />)
    expect(document.body.classList.contains(SCROLL_LOCK_CLASS)).toBe(true)
    unmount()
    expect(document.body.classList.contains(SCROLL_LOCK_CLASS)).toBe(false)
  })
})
