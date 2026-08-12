// 秀展列表頁「負責 Planner／設計師」篩選器用的純函式，跟 project.assignments
// (格式：[{ personId, role: 'planner' | 'designer' }]，見 TradeshowEditModal.jsx)搭配。

// 從一批秀展裡，取出「有被指派某個角色」的所有 personId(去重)，用來當篩選器的選項清單。
export function assignedPersonIds(projects, role) {
  return [...new Set(
    (projects || []).flatMap((p) => (p.assignments || [])
      .filter((a) => a?.role === role)
      .map((a) => a.personId)),
  )]
}

// 某場秀展是否有指派到「ids 清單裡任一人」擔任這個角色 —— 篩選器的核心判斷式。
export function hasAssignedPerson(project, role, ids) {
  return (project?.assignments || []).some((a) => a?.role === role && ids.includes(a.personId))
}
