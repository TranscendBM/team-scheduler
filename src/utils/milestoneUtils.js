// Default milestone rules (weeks before show start)
export const DEFAULT_RULES = {
  // ── Tradeshow: flat fallback (used when no loading level) ───────
  designerStart: 8,
  plannerStart: 8,
  invitationLetter: 4,
  pressRelease: 2,
  linkedinPreview: 1,
  linkedinPost: 0,

  // ── Tradeshow: per loading level ────────────────────────────────
  designerStart_輕度: 6,   designerStart_中度: 8,   designerStart_高度: 10,
  plannerStart_輕度: 6,    plannerStart_中度: 8,    plannerStart_高度: 10,
  invitationLetter_輕度: 3, invitationLetter_中度: 4, invitationLetter_高度: 5,
  pressRelease_輕度: 1,    pressRelease_中度: 2,    pressRelease_高度: 3,
  linkedinPreview_輕度: 1, linkedinPreview_中度: 1, linkedinPreview_高度: 2,

  // ── Seasonal KV ─────────────────────────────────────────────────
  kvKickoff: 6,   // 發稿給設計師（活動前幾週）
  kvRelease: 4,   // 發佈KV給業務（活動前幾週）
}

export const MILESTONE_LABELS = {
  designerStart: '設計師開始',
  plannerStart: 'Planner 開始',
  invitationLetter: '邀請函',
  pressRelease: '新聞稿',
  linkedinPreview: 'LinkedIn 預告',
  linkedinPost: 'LinkedIn 發文',
  kvKickoff: 'KV 發稿',
  kvRelease: 'KV 發佈',
}

export const TYPE_COLORS = {
  tradeshow: '#3B82F6',
  event: '#F97316',
  award: '#10B981',
  seasonal_kv: '#EC4899',   // legacy – kept for backward compat
  design: '#6366F1',        // new: 設計類（含季節KV、型錄、桌曆…）
}

export const TYPE_LABELS = {
  tradeshow: '秀展',
  event: '活動',
  award: '報獎',
  seasonal_kv: 'Seasonal KV',
  design: '設計類',
}

export const TYPE_BG = {
  tradeshow: 'bg-blue-100 text-blue-700',
  event: 'bg-orange-100 text-orange-700',
  award: 'bg-emerald-100 text-emerald-700',
  seasonal_kv: 'bg-pink-100 text-pink-700',
  design: 'bg-indigo-100 text-indigo-700',
}

// Loading level based on booth count and project name
export function getLoadingLevel(boothSize, projectName) {
  if (projectName && projectName.toUpperCase().includes('COMPUTEX')) return '高度'
  const count = parseInt(boothSize) || 0
  if (count <= 0) return null
  if (count >= 9) return '高度'
  if (count >= 5) return '中度'
  return '輕度'
}

export const LOADING_COLORS = {
  '輕度': { bg: '#bfdbfe', text: '#1e40af' },
  '中度': { bg: '#fed7aa', text: '#9a3412' },
  '高度': { bg: '#fca5a5', text: '#7f1d1d' },
}

/**
 * Subtract weeks from a date
 */
function subWeeks(date, weeks) {
  const d = new Date(date)
  d.setDate(d.getDate() - weeks * 7)
  return d
}

/**
 * Resolve a rule value: use per-loading-level key if available, else fall back to base key
 */
function resolveRule(r, baseKey, loadingLevel) {
  if (loadingLevel) {
    const lk = `${baseKey}_${loadingLevel}`
    if (r[lk] != null) return r[lk]
  }
  return r[baseKey]
}

/**
 * Calculate work start date for a person based on their role, milestone rules, and loading level
 */
export function getWorkStart(projectStartDate, role, rules, loadingLevel) {
  const r = { ...DEFAULT_RULES, ...rules }
  const start = new Date(projectStartDate)
  const baseKey = role === 'designer' ? 'designerStart' : 'plannerStart'
  const weeks = resolveRule(r, baseKey, loadingLevel)
  return subWeeks(start, weeks)
}

/**
 * Get all milestone dates for a trade show project (planner only)
 */
export function getMilestones(projectStartDate, rules, loadingLevel) {
  const r = { ...DEFAULT_RULES, ...rules }
  const start = new Date(projectStartDate)
  const rv = (key) => resolveRule(r, key, loadingLevel)
  return [
    { key: 'invitationLetter', date: subWeeks(start, rv('invitationLetter')), label: '邀請函' },
    { key: 'pressRelease', date: subWeeks(start, rv('pressRelease')), label: '新聞稿' },
    { key: 'linkedinPreview', date: subWeeks(start, rv('linkedinPreview')), label: 'LinkedIn 預告' },
    { key: 'linkedinPost', date: start, label: 'LinkedIn 發文' },
  ]
}

/**
 * Get Seasonal KV milestone dates (kickoff → release → event date)
 */
export function getKVMilestones(eventDate, rules) {
  const r = { ...DEFAULT_RULES, ...rules }
  return [
    { key: 'kvRelease', date: subWeeks(new Date(eventDate), r.kvRelease), label: '發佈KV' },
  ]
}

/**
 * Build gantt bars for a person across all projects
 */
export function buildBarsForPerson(personId, projects, rules) {
  const bars = []
  for (const project of projects) {
    const assignments = (project.assignments || []).filter(a => a.personId === personId)
    for (const assignment of assignments) {
      let workStart, workEnd, milestones

      if (project.type === 'tradeshow') {
        const level = getLoadingLevel(project.boothSize, project.name)
        workStart = getWorkStart(project.startDate, assignment.role, rules, level)
        workEnd = new Date(project.endDate)
        milestones = assignment.role === 'planner' ? getMilestones(project.startDate, rules, level) : []
      } else if (project.type === 'seasonal_kv') {
        // Legacy type – backward compat
        workStart = new Date(project.startDate)
        workEnd = new Date(project.endDate)
        milestones = project.endDate ? getKVMilestones(project.endDate, rules) : []
      } else if (project.type === 'design') {
        workStart = new Date(project.startDate)
        workEnd = new Date(project.endDate)
        // Only '季節KV' subtype gets KV milestone
        milestones = (project.designSubtype === '季節KV' && project.endDate)
          ? getKVMilestones(project.endDate, rules) : []
      } else {
        workStart = new Date(project.startDate)
        workEnd = new Date(project.endDate)
        milestones = []
      }

      bars.push({
        projectId: project.id,
        projectName: project.name,
        type: project.type,
        role: assignment.role,
        workStart,
        workEnd,
        color: TYPE_COLORS[project.type] || '#6B7280',
        milestones,
        loadingLevel: project.type === 'tradeshow'
          ? getLoadingLevel(project.boothSize, project.name)
          : null,
        boothSize: project.boothSize || null,
        artworkDone: project.type === 'tradeshow' ? !!project.artworkDone : false,
      })
    }
  }
  return bars
}
