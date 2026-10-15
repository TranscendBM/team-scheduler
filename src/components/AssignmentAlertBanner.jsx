import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotifications } from '../contexts/NotificationsContext'

const MAX_SHOWN = 5

// 站內明顯通知：設計師有新發稿被指派給自己、planner 提交的需求被主管指派下去時，
// 在所有頁面最上方顯示黏著的橫幅(捲動時也看得到)，點項目直接開該筆需求，
// 或按「全部知道了」一次清掉。分頁標題也會加上 (N)，切到別的分頁時一樣看得到。
export default function AssignmentAlertBanner() {
  const { alerts, markSeen, markAllSeen } = useNotifications()
  const navigate = useNavigate()
  const count = alerts.length

  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, '')
    document.title = count > 0 ? `(${count}) ${base}` : base
    return () => { document.title = base }
  }, [count])

  if (count === 0) return null

  function openAlert(a) {
    markSeen(a.id)
    navigate(a.kind === 'assigned-to-me' ? `/requests?open=${a.id}` : `/my-requests?open=${a.id}`)
  }

  return (
    <div className="sticky top-0 z-20 bg-gray-50 px-4 pt-3 pb-1">
      <div role="alert" className="rounded-xl border-2 border-red-300 bg-red-50 shadow-sm px-4 py-3">
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <p className="text-sm font-bold text-red-700">🔔 你有 {count} 筆新發稿通知</p>
          <button onClick={() => markAllSeen(alerts.map(a => a.id))}
            className="text-xs text-red-600 hover:underline shrink-0">全部知道了</button>
        </div>
        <ul className="space-y-1">
          {alerts.slice(0, MAX_SHOWN).map(a => {
            const r = a.request
            const name = r.projectName || r.title || '（未命名）'
            const designers = (r.assignedDesignersNames?.length ? r.assignedDesignersNames : (r.assignedDesigners || [])).join('、')
            return (
              <li key={a.id}>
                <button onClick={() => openAlert(a)}
                  className="w-full text-left text-sm text-gray-800 hover:bg-red-100 rounded-lg px-2 py-1.5 transition-colors">
                  {a.kind === 'assigned-to-me' ? (
                    <>
                      <span className="inline-block text-[10px] font-bold bg-red-500 text-white rounded px-1 py-0.5 mr-1.5 align-middle leading-none">NEW</span>
                      <b>{name}</b>
                      <span className="text-gray-500 text-xs ml-1.5">{r.region ? `${r.region} · ` : ''}交期 {r.dueDate || '未指定'}</span>
                    </>
                  ) : (
                    <>
                      <span className="inline-block text-[10px] font-bold bg-emerald-600 text-white rounded px-1 py-0.5 mr-1.5 align-middle leading-none">已指派</span>
                      你提交的「<b>{name}</b>」已審核並指派給 {designers || '設計師'}
                    </>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
        {count > MAX_SHOWN && <p className="text-xs text-gray-500 mt-1 px-2">還有 {count - MAX_SHOWN} 筆，請到需求總表查看</p>}
      </div>
    </div>
  )
}
