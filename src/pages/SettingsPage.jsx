import { useEffect, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { DEFAULT_RULES } from '../utils/milestoneUtils'

// Tradeshow milestone rows (with loading-level variants)
const TRADESHOW_ROWS = [
  { key: 'designerStart',   label: '設計師開始設計',  role: '設計師', desc: '秀展前幾週' },
  { key: 'plannerStart',    label: 'Planner 開始規劃', role: 'Planner', desc: '秀展前幾週' },
  { key: 'invitationLetter',label: '邀請函準備',       role: 'Planner', desc: '秀展前幾週' },
  { key: 'pressRelease',    label: '新聞稿發布',       role: 'Planner', desc: '秀展前幾週' },
  { key: 'linkedinPreview', label: 'LinkedIn 預告',   role: 'Planner', desc: '秀展前幾週' },
]

const LEVELS = ['輕度', '中度', '高度']
const LEVEL_COLORS = {
  '輕度': 'text-blue-700 bg-blue-50',
  '中度': 'text-orange-700 bg-orange-50',
  '高度': 'text-red-700 bg-red-50',
}

const KV_ROWS = [
  { key: 'kvKickoff', label: 'KV 發稿給設計師', desc: '活動前幾週' },
  { key: 'kvRelease', label: 'KV 發佈給業務',   desc: '活動前幾週' },
]

export default function SettingsPage() {
  const { isManager } = useAuth()
  const [rules, setRules] = useState(DEFAULT_RULES)
  const [original, setOriginal] = useState(DEFAULT_RULES)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadRules = async () => {
      const rd = await getDoc(doc(db, 'settings', 'milestoneRules'))
      if (rd.exists()) {
        const data = { ...DEFAULT_RULES, ...rd.data() }
        setRules(data)
        setOriginal(data)
      }
      setLoading(false)
    }
    loadRules()
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      await setDoc(doc(db, 'settings', 'milestoneRules'), rules)
      setOriginal(rules)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  function handleReset() { setRules(DEFAULT_RULES) }

  function getVal(key, level) {
    const lk = level ? `${key}_${level}` : key
    return rules[lk] ?? rules[key] ?? 0
  }

  function setVal(key, level, delta) {
    const lk = level ? `${key}_${level}` : key
    setRules(r => ({ ...r, [lk]: Math.max(0, (r[lk] ?? r[key] ?? 0) + delta) }))
  }

  const hasChanges = JSON.stringify(rules) !== JSON.stringify(original)

  if (loading) return <div className="flex items-center justify-center h-full text-gray-500">載入中…</div>

  const Stepper = ({ baseKey, level }) => {
    const val = getVal(baseKey, level)
    return (
      <div className="flex items-center justify-center gap-1">
        {isManager ? (
          <>
            <button onClick={() => setVal(baseKey, level, -1)} disabled={val <= 0}
              className="w-6 h-6 flex items-center justify-center rounded border border-gray-200 hover:bg-gray-100 text-gray-600 disabled:opacity-30 text-sm font-bold">−</button>
            <span className="w-8 text-center text-sm font-semibold text-gray-800">{val}</span>
            <button onClick={() => setVal(baseKey, level, +1)}
              className="w-6 h-6 flex items-center justify-center rounded border border-gray-200 hover:bg-gray-100 text-gray-600 text-sm font-bold">+</button>
          </>
        ) : (
          <span className="text-sm font-semibold text-gray-700">{val === 0 ? '當天' : `${val} 週`}</span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <div>
          <h2 className="text-xl font-bold text-gray-800">里程碑設定</h2>
          <p className="text-sm text-gray-500">依秀展 Loading 程度設定各工作項目的提前週數</p>
        </div>
        {isManager && (
          <div className="flex items-center gap-2">
            {saved && <span className="text-sm text-emerald-600 font-medium">✓ 已儲存</span>}
            <button onClick={handleReset} className="px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">
              還原預設
            </button>
            <button onClick={handleSave} disabled={saving || !hasChanges}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium">
              {saving ? '儲存中…' : '儲存設定'}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6 max-w-3xl">

        {/* ── 秀展里程碑（分 loading 等級） ── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
            <span className="text-blue-700 font-semibold text-sm">📊 秀展里程碑</span>
            <span className="text-xs text-blue-500">依 Loading 程度設定不同提前週數</span>
          </div>

          {/* Table header */}
          <div className="grid px-5 py-2.5 border-b bg-gray-50 text-xs font-semibold text-gray-500"
            style={{ gridTemplateColumns: '1fr 90px 90px 90px' }}>
            <div>工作項目</div>
            {LEVELS.map(lv => (
              <div key={lv} className="text-center">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${LEVEL_COLORS[lv]}`}>{lv}</span>
              </div>
            ))}
          </div>

          {/* Rows */}
          <div className="divide-y divide-gray-100">
            {TRADESHOW_ROWS.map(row => (
              <div key={row.key} className="grid px-5 py-3 items-center"
                style={{ gridTemplateColumns: '1fr 90px 90px 90px' }}>
                <div>
                  <p className="text-sm font-medium text-gray-800">{row.label}</p>
                  <p className="text-xs text-gray-500">{row.desc} ·
                    <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${row.role === '設計師' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700'}`}>
                      {row.role}
                    </span>
                  </p>
                </div>
                {LEVELS.map(lv => (
                  <div key={lv}><Stepper baseKey={row.key} level={lv} /></div>
                ))}
              </div>
            ))}

            {/* LinkedIn post row — always on event day */}
            <div className="grid px-5 py-3 items-center" style={{ gridTemplateColumns: '1fr 90px 90px 90px' }}>
              <div>
                <p className="text-sm font-medium text-gray-800">LinkedIn 發文</p>
                <p className="text-xs text-gray-500">開展當天 · <span className="ml-1 text-xs px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700">Planner</span></p>
              </div>
              {LEVELS.map(lv => (
                <div key={lv} className="text-center">
                  <span className="text-xs text-gray-500 italic">開展當天</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Seasonal KV ── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 bg-pink-50 border-b border-pink-100 flex items-center gap-2">
            <span className="text-pink-700 font-semibold text-sm">🌸 Seasonal KV 里程碑</span>
          </div>
          <div className="divide-y divide-gray-100">
            {KV_ROWS.map(row => (
              <div key={row.key} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <p className="text-sm font-medium text-gray-800">{row.label}</p>
                  <p className="text-xs text-gray-500">{row.desc}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Stepper baseKey={row.key} level={null} />
                  <span className="text-sm text-gray-500 w-8">週前</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Preview ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">📅 預覽（假設開展日：6/2，中度）</h3>
          <div className="space-y-2">
            {[
              { key: 'designerStart', role: '設計師', label: '開始設計海報' },
              { key: 'plannerStart', role: 'Planner', label: '開始規劃內容' },
              { key: 'invitationLetter', role: 'Planner', label: '準備邀請函' },
              { key: 'pressRelease', role: 'Planner', label: '發布新聞稿' },
              { key: 'linkedinPreview', role: 'Planner', label: 'LinkedIn 預告' },
            ].map(({ key, role, label }) => {
              const w = getVal(key, '中度')
              const showDate = new Date(2026, 5, 2)
              const taskDate = new Date(showDate)
              taskDate.setDate(taskDate.getDate() - w * 7)
              return (
                <div key={key} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${role === '設計師' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700'}`}>{role}</span>
                    <span className="text-gray-600">{label}</span>
                  </div>
                  <span className="text-gray-800 font-medium">
                    {taskDate.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })}
                  </span>
                </div>
              )
            })}
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">Planner</span>
                <span className="text-gray-600">LinkedIn 發文</span>
              </div>
              <span className="text-gray-800 font-medium">6/2（開展當天）</span>
            </div>
          </div>
        </div>

        {!isManager && (
          <p className="text-sm text-gray-500 text-center">只有管理者可以修改設定</p>
        )}
      </div>
    </div>
  )
}
