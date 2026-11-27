import SimpleProjectPage from '../components/SimpleProjectPage'

const EVENT_SUBTYPES = ['尾牙', '春酒', '媒體春酒', 'HBL', '灣聲音樂會', '其他']

// 開始日期 → 開始籌備日期、結束日期 → 活動日期；列表依活動日期排序
export default function EventsPage() {
  return (
    <SimpleProjectPage type="event" typeLabel="活動" subtypeOptions={EVENT_SUBTYPES} subtypeFieldLabel="活動類型"
      sortBy="endDate" dateLabels={{ start: '開始籌備日期', end: '活動日期' }} />
  )
}
