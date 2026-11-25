import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../contexts/PermissionsContext'
import DesignPage from './DesignPage'
import RotationPage from './RotationPage'

// 專案管理 › 設計：把「設計專案」與「輪值」放在同一個介面，用分頁切換。
// 兩頁各自維護、互不影響；分頁用網址 ?tab=rotation 記住，舊的 /projects/rotation 會導到這裡。
const TABS = [
  { key: 'design', label: '設計專案', pageKey: 'projects-design' },
  { key: 'rotation', label: '輪值', pageKey: 'projects-rotation' },
]

export default function DesignHubPage() {
  const { role } = useAuth()
  const { canAccess } = usePermissions()
  const [searchParams, setSearchParams] = useSearchParams()

  const tabs = TABS.filter(t => canAccess(t.pageKey, role))
  const wanted = searchParams.get('tab')
  const tab = tabs.find(t => t.key === wanted) || tabs[0]
  if (!tab) return null

  const select = (key) => setSearchParams(key === 'design' ? {} : { tab: key }, { replace: true })

  return (
    <div className="flex flex-col h-full">
      {tabs.length > 1 && (
        <div className="px-6 pt-3 bg-white border-b flex gap-1" role="tablist">
          {tabs.map(t => (
            <button key={t.key} role="tab" aria-selected={t.key === tab.key} onClick={() => select(t.key)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${t.key === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0">
        {tab.key === 'design' ? <DesignPage /> : <RotationPage />}
      </div>
    </div>
  )
}
