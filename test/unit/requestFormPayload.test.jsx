// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// RWD 重構只動版型，送出的 payload 一定要跟改版前一模一樣。
// 這裡把 Firestore / Storage / Auth 全部換成假的（不連任何 Firebase 專案、不寫入任何資料），
// 只檢查「送出時傳給 addDoc 的欄位」。
const addDoc = vi.fn(async () => ({ id: 'new-request-id' }))
const updateDoc = vi.fn(async () => {})

vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ __collection: name }),
  doc: (_db, name, id) => ({ __doc: `${name}/${id}` }),
  addDoc: (...args) => addDoc(...args),
  updateDoc: (...args) => updateDoc(...args),
  getDoc: vi.fn(async () => ({ exists: () => false })),
  deleteDoc: vi.fn(async () => {}),
  serverTimestamp: () => '__SERVER_TIMESTAMP__',
}))
vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(async () => {}),
  getDownloadURL: vi.fn(async () => 'https://example.invalid/x'),
  deleteObject: vi.fn(async () => {}),
}))
vi.mock('../../src/firebase', () => ({ db: {}, storage: {}, functions: {}, auth: {} }))
vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { displayName: '王小明' }, email: 'ming@example.com' }),
}))

const { default: RequestNewPage } = await import('../../src/pages/RequestNewPage.jsx')

afterEach(() => {
  cleanup()
  addDoc.mockClear()
  updateDoc.mockClear()
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/request/new']}>
      <Routes>
        <Route path="/request/new" element={<RequestNewPage />} />
        <Route path="/my-requests" element={<div>我的需求</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('提交需求的 payload（RWD 重構後不變）', () => {
  it('必填欄位缺漏時顯示錯誤、不送出', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: '送出需求' }))
    expect(await screen.findByText('請選擇地區')).toBeTruthy()
    expect(addDoc).not.toHaveBeenCalled()
  })

  it('填完必填欄位送出時，寫入 Firestore 的欄位與舊版完全一致', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()

    await user.selectOptions(screen.getByRole('combobox'), 'SD1')
    await user.type(screen.getByPlaceholderText(/區域_案名_類型/), 'LA_FathersDay_Banner')
    await user.click(screen.getByRole('checkbox', { name: /Poster/ }))
    await user.click(screen.getByRole('checkbox', { name: /Banner/ }))
    const dateInput = container.querySelector('input[type="date"]')
    await user.type(dateInput, '2026-10-01')
    await user.type(screen.getByPlaceholderText(/原設計師/), '  沿用去年版型  ')

    await user.click(screen.getByRole('button', { name: '送出需求' }))

    await waitFor(() => expect(addDoc).toHaveBeenCalledTimes(1))
    const [target, payload] = addDoc.mock.calls[0]
    expect(target).toEqual({ __collection: 'requests' })
    expect(payload).toEqual({
      urgent: false,
      region: 'SD1',
      projectName: 'LA_FathersDay_Banner',
      docTypes: ['Poster', 'Banner'],
      dueDate: '2026-10-01',
      description: '沿用去年版型',
      attachments: [],
      submittedBy: 'ming@example.com',
      submittedByName: '王小明',
      status: 'pending',
      createdAt: '__SERVER_TIMESTAMP__',
    })
  })

  it('勾選急件時 urgent 會是 true，其餘欄位不受影響', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()

    await user.click(screen.getByRole('checkbox', { name: /急件/ }))
    await user.selectOptions(screen.getByRole('combobox'), 'HQ')
    await user.type(screen.getByPlaceholderText(/區域_案名_類型/), 'HQ_Test_DM')
    await user.click(screen.getByRole('checkbox', { name: /^DM$/ }))
    await user.type(container.querySelector('input[type="date"]'), '2026-01-05')

    await user.click(screen.getByRole('button', { name: '送出需求' }))
    await waitFor(() => expect(addDoc).toHaveBeenCalledTimes(1))
    expect(addDoc.mock.calls[0][1]).toMatchObject({
      urgent: true,
      region: 'HQ',
      projectName: 'HQ_Test_DM',
      docTypes: ['DM'],
      dueDate: '2026-01-05',
      description: '',
    })
  })
})
