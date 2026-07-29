import SimpleProjectPage from '../components/SimpleProjectPage'

const AWARD_SUBTYPES = ['25大國際品牌', '台灣精品獎', 'BC Award', '體育推手獎', 'EE Awards']

export default function AwardsPage() {
  return <SimpleProjectPage type="award" typeLabel="報獎" subtypeOptions={AWARD_SUBTYPES} subtypeFieldLabel="獎項" sortBy="endDate" />
}
