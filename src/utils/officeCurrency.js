// 分公司顯示／篩選的固定順序（HQ 排最前）。全系統共用同一套排序：
// 秀展年度目標、展覽列表篩選都依此排序，不在此清單內的代碼依字母序附加在後。
export const OFFICE_ORDER = ['HQ', 'TW', 'US', 'GM', 'NL', 'UK', 'JP', 'KR', 'BJ', 'SH', 'SZ']

export function sortByOfficeOrder(offices) {
  return [...offices].sort((a, b) => {
    const ia = OFFICE_ORDER.indexOf(a), ib = OFFICE_ORDER.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
}

// 各分公司負責秀展時，帳務慣用的當地貨幣別（依 Elvis 提供的對照）
export const OFFICE_CURRENCY = {
  TW: 'TWD',
  HQ: 'TWD', // Computex 等由台灣總部（HQ）主辦的秀展

  US: 'USD',
  GM: 'EUR',
  NL: 'EUR',
  UK: 'GBP',
  JP: 'JPY',
  KR: 'KRW',
  BJ: 'CNY',
  SH: 'CNY',
  SZ: 'CNY',
}
