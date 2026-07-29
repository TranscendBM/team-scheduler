import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, onSnapshot, query, where, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { statusMeta } from '../utils/requestConstants'
import { TYPE_COLORS, TYPE_LABELS } from '../utils/milestoneUtils'
import RequestDetailModal from '../components/RequestDetailModal'

const PROJECT_TYPES = ['event', 'award', 'design', 'seasonal_kv']
const PROJECT_LINK = { event: '/projects/event', award: '/projects/award', design: '/projects/design', seasonal_kv: '/projects/design' }
const LEAVE_COLORS = { '特休': '#8b5cf6', '病假': '#f59e0b', '事假': '#6b7280', '出差': '#0ea5e9', '其他': '#d1d5db' }

function todayStr() { return new Date().toISOString().slice(0, 10) }
function addDaysStr(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// 主管儀表板：活動／報獎／設計三個獨立區塊共用的卡片渲染（純函式，非元件，避免每次 render 都重新定義元件）
function projectBlock(icon, label, list, linkTo, emptyText) {
  return (
    <div key={label} className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-sm font-semibold text-gray-700 mb-3">{icon} {label}</p>
      {list.length === 0 ? (
        <p className="text-sm text-gray-300 py-4 text-center">{emptyText}</p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {list.map(p => (
            <Link key={p.id} to={linkTo}
              className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors">
              <p className="text-sm font-medium text-gray-800 truncate flex-1 min-w-0">{p.name}</p>
              <span className="text-xs text-gray-400 whitespace-nowrap ml-2">
                {p.startDate ? `${p.startDate}${p.endDate ? ' ~ ' + p.endDate : ''}` : ''}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const { user, email, role } = useAuth()
  const [people, setPeople] = useState([])
  const [projects, setProjects] = useState([])
  const [myRequests, setMyRequests] = useState([])         // planner：我送出的需求
  const [assignedRequests, setAssignedRequests] = useState([]) // designer：指派給我、設計中/確認中的需求
  const [detail, setDetail] = useState(null)

  const [myUser, setMyUser] = useState(null)
  const [leaves, setLeaves] = useState([])

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'people'), snap => setPeople(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    const u2 = onSnapshot(collection(db, 'projects'), snap => setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return () => { u1(); u2() }
  }, [])

  // 休假預排只有主管的儀表板需要，其他角色不訂閱
  useEffect(() => {
    if (role !== 'manager') return
    const unsub = onSnapshot(collection(db, 'leaves'), snap => setLeaves(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return unsub
  }, [role])

  // people.email 存的是公司信箱，登入用的是 Gmail（users 的 doc id）；
  // 兩邊的橋接欄位是 users.notifyEmail（跟 people.email 是同一組公司信箱）
  useEffect(() => {
    if (!email) return
    const unsub = onSnapshot(doc(db, 'users', email), snap => setMyUser(snap.exists() ? snap.data() : null))
    return unsub
  }, [email])

  useEffect(() => {
    if (!email) return
    let unsub = () => {}
    if (role === 'planner') {
      unsub = onSnapshot(query(collection(db, 'requests'), where('submittedBy', '==', email)), snap => {
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
        setMyRequests(rows.slice(0, 6))
      })
    } else if (role === 'designer') {
      unsub = onSnapshot(query(collection(db, 'requests'), where('assignedDesigners', 'array-contains', email)), snap => {
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => ['in_progress', 'reviewing'].includes(r.status))
        rows.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
        setAssignedRequests(rows)
      })
    }
    return unsub
  }, [email, role])

  const myCompanyEmail = myUser?.notifyEmail?.trim().toLowerCase()
  const me = myCompanyEmail
    ? people.find(p => p.email && p.email.trim().toLowerCase() === myCompanyEmail)
    : null
  const today = todayStr()
  const in90 = addDaysStr(90)

  const myTradeshows = me
    ? projects.filter(p => p.type === 'tradeshow' && (p.assignments || []).some(a => a.personId === me.id))
    : []
  const ongoingShows = myTradeshows
    .filter(p => p.startDate && p.endDate && p.startDate <= today && p.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
  const upcomingShows = myTradeshows
    .filter(p => p.startDate && p.startDate > today && p.startDate <= in90)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))

  const myProjects = me
    ? projects
        .filter(p => PROJECT_TYPES.includes(p.type) && (p.assignments || []).some(a => a.personId === me.id))
        .filter(p => !p.endDate || p.endDate >= today)
        .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))
        .slice(0, 8)
    : []

  // 主管：公司範圍內近三個月的秀展清單（進行中＋未來三個月，不限「我負責」）
  const companyUpcomingShows = role === 'manager'
    ? projects
        .filter(p => p.type === 'tradeshow')
        .filter(p => p.startDate && ((p.endDate && p.startDate <= today && p.endDate >= today) || (p.startDate > today && p.startDate <= in90)))
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
    : []

  // 主管：公司範圍內未來三個月的活動／報獎／設計專案（不限「我負責」），分開三類各自呈現
  function companyProjectsByType(type) {
    if (role !== 'manager') return []
    return projects
      .filter(p => type === 'design' ? (p.type === 'design' || p.type === 'seasonal_kv') : p.type === type)
      .filter(p => (!p.endDate || p.endDate >= today) && (!p.startDate || p.startDate <= in90))
      .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))
  }
  const companyEvents = companyProjectsByType('event')
  const companyAwards = companyProjectsByType('award')
  const companyDesigns = companyProjectsByType('design')

  // 主管：未來一個月的休假預排
  const in30 = addDaysStr(30)
  const upcomingLeaves = role === 'manager'
    ? leaves
        .filter(l => l.startDate && l.endDate && l.endDate >= today && l.startDate <= in30)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
    : []

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">{user?.displayName ? `${user.displayName}，你好` : '總覽'}</h1>
      <p className="text-sm text-gray-400 mb-6">登入時的重點資訊一覽</p>

      {role !== 'manager' && !me && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 text-sm text-amber-700">
          「人員管理」尚未設定你的 email 對照，無法顯示你被指派的秀展／專案，請聯絡主管補上。
        </div>
      )}

      {/* 秀展 */}
      {role !== 'manager' && (
      <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-gray-700">🎪 進行中的秀展</p>
            <Link to="/tradeshow-list" className="text-xs text-blue-500 hover:underline">查看全部 →</Link>
          </div>
          {ongoingShows.length === 0 ? (
            <p className="text-sm text-gray-300 py-4 text-center">目前沒有進行中的秀展</p>
          ) : (
            <div className="space-y-2">
              {ongoingShows.map(p => (
                <div key={p.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-blue-50/60">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                    <p className="text-xs text-gray-400">{p.office || ''} {p.location || ''}</p>
                  </div>
                  <span className="text-xs text-blue-600 whitespace-nowrap ml-2">{p.startDate}~{p.endDate}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-gray-700">📅 未來三個月即將開展</p>
            <Link to="/tradeshow-gantt" className="text-xs text-blue-500 hover:underline">查看甘特圖 →</Link>
          </div>
          {upcomingShows.length === 0 ? (
            <p className="text-sm text-gray-300 py-4 text-center">未來三個月沒有你負責的秀展</p>
          ) : (
            <div className="space-y-2">
              {upcomingShows.map(p => (
                <div key={p.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                    <p className="text-xs text-gray-400">{p.office || ''} {p.location || ''}</p>
                  </div>
                  <span className="text-xs text-gray-500 whitespace-nowrap ml-2">{p.startDate}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 專案項目（活動/報獎/設計） */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <p className="text-sm font-semibold text-gray-700 mb-3">📁 我近期要負責的專案項目</p>
        {myProjects.length === 0 ? (
          <p className="text-sm text-gray-300 py-4 text-center">目前沒有你負責的活動／報獎／設計項目</p>
        ) : (
          <div className="space-y-2">
            {myProjects.map(p => (
              <Link key={p.id} to={PROJECT_LINK[p.type] || '/projects/event'}
                className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: TYPE_COLORS[p.type] }} />
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 flex-shrink-0">{TYPE_LABELS[p.type]}</span>
                  <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap ml-2">
                  {p.startDate ? `${p.startDate}${p.endDate ? ' ~ ' + p.endDate : ''}` : ''}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
      </>
      )}

      {/* 主管：近三個月秀展清單 + 活動／報獎／設計（各自獨立區塊）+ 未來一個月休假預排 */}
      {role === 'manager' && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-700">🎪 近三個月的秀展清單</p>
              <Link to="/tradeshow-list" className="text-xs text-blue-500 hover:underline">查看全部 →</Link>
            </div>
            {companyUpcomingShows.length === 0 ? (
              <p className="text-sm text-gray-300 py-4 text-center">近三個月沒有秀展</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {companyUpcomingShows.map(p => (
                  <div key={p.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                      <p className="text-xs text-gray-400">{p.office || ''} {p.location || ''}</p>
                    </div>
                    <span className="text-xs text-gray-500 whitespace-nowrap ml-2">{p.startDate}{p.endDate ? `~${p.endDate}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {projectBlock('🎉', '活動', companyEvents, '/projects/event', '未來三個月沒有活動項目')}
            {projectBlock('🏆', '報獎', companyAwards, '/projects/award', '未來三個月沒有報獎項目')}
            {projectBlock('🎨', '設計', companyDesigns, '/projects/design', '未來三個月沒有設計項目')}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-700">🏖️ 未來一個月的休假預排</p>
              <Link to="/leave" className="text-xs text-blue-500 hover:underline">查看全部 →</Link>
            </div>
            {upcomingLeaves.length === 0 ? (
              <p className="text-sm text-gray-300 py-4 text-center">未來一個月沒有排休</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {upcomingLeaves.map(l => (
                  <div key={l.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: LEAVE_COLORS[l.type] || '#d1d5db' }} />
                      <p className="text-sm font-medium text-gray-800 truncate">{l.personName}</p>
                      <span className="text-xs text-gray-400 flex-shrink-0">{l.type}</span>
                    </div>
                    <span className="text-xs text-gray-500 whitespace-nowrap ml-2">
                      {l.startDate === l.endDate ? l.startDate : `${l.startDate} ~ ${l.endDate}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Planner：我送出的發稿需求 */}
      {role === 'planner' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-gray-700">📝 我近期提交的發稿需求</p>
            <Link to="/my-requests" className="text-xs text-blue-500 hover:underline">查看全部 →</Link>
          </div>
          {myRequests.length === 0 ? (
            <p className="text-sm text-gray-300 py-4 text-center">你還沒有送出任何需求</p>
          ) : (
            <div className="space-y-2">
              {myRequests.map(r => {
                const meta = statusMeta(r.status)
                return (
                  <button key={r.id} onClick={() => setDetail(r)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
                    <p className="flex-1 min-w-0 text-sm font-medium text-gray-800 truncate">{r.projectName || r.title}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${meta.color}`}>{meta.label}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Designer：我負責的發稿（設計中/確認中） */}
      {role === 'designer' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-gray-700">🎨 我負責的發稿（設計中／確認中）</p>
            <Link to="/requests" className="text-xs text-blue-500 hover:underline">查看總表 →</Link>
          </div>
          {assignedRequests.length === 0 ? (
            <p className="text-sm text-gray-300 py-4 text-center">目前沒有設計中或確認中的發稿</p>
          ) : (
            <div className="space-y-2">
              {assignedRequests.map(r => {
                const meta = statusMeta(r.status)
                return (
                  <button key={r.id} onClick={() => setDetail(r)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
                    <p className="flex-1 min-w-0 text-sm font-medium text-gray-800 truncate">
                      {r.urgent && <span className="text-red-500 mr-1">🔥</span>}{r.projectName || r.title}
                    </p>
                    <span className="text-xs text-gray-400 whitespace-nowrap">交期 {r.dueDate || '未指定'}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${meta.color}`}>{meta.label}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      <RequestDetailModal r={detail} onClose={() => setDetail(null)} />
    </div>
  )
}
