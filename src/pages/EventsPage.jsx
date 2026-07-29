import SimpleProjectPage from '../components/SimpleProjectPage'

const EVENT_SUBTYPES = ['尾牙', '春酒', '媒體春酒', 'HBL', '灣聲音樂會']

export default function EventsPage() {
  return <SimpleProjectPage type="event" typeLabel="活動" subtypeOptions={EVENT_SUBTYPES} subtypeFieldLabel="活動類型" />
}
