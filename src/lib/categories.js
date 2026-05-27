// Transaction stages. The `categories` list only powers autocomplete —
// users can still type any custom category.
export const STAGE_META = {
  수입: {
    key: '수입',
    color: '#16a34a',
    categories: ['급여', '보너스', '사업소득', '이자/배당', '용돈', '환급', '중고판매', '기타'],
  },
  지출: {
    key: '지출',
    color: '#dc2626',
    categories: [
      '식비',
      '주거/관리',
      '교통',
      '통신',
      '생활용품',
      '의료/건강',
      '문화/여가',
      '교육',
      '경조사',
      '기부/후원',
      '보험',
      '기타',
    ],
  },
}

// Investment product kinds shown in the 투자 tab.
// 환율 is kept in INVEST_META so legacy 환율 items from older data still render,
// but it is intentionally excluded from INVEST_KINDS — representative FX rates
// now live in the top stat grid, not as user-added widgets.
export const INVEST_META = {
  예금: { kind: '예금', color: '#0891b2', desc: '목돈을 한 번에 예치하고 이자를 받습니다' },
  적금: { kind: '적금', color: '#4f46e5', desc: '매달 일정 금액을 적립합니다' },
  주식: { kind: '주식', color: '#d97706', desc: '종목을 매수하고 평가손익을 추적합니다' },
  비트코인: { kind: '비트코인', color: '#f97316', desc: '비트코인 수량과 평단을 입력하고 BTC/KRW 현재가로 추적합니다' },
  자산: { kind: '자산', color: '#0f766e', desc: '현금성자산, 금, 외화 등 직접 평가액을 관리합니다' },
  환율: { kind: '환율', color: '#059669', desc: '원하는 통화 환율을 조회하고 해외 주식 평가에 사용합니다' },
}

export const INVEST_KINDS = ['예금', '적금', '주식', '비트코인', '자산']

export const INVEST_COLOR = '#0e7490'
export const SUMMARY_COLOR = '#7c3aed'
export const TAX_COLOR = '#0f766e'

// Maps a 지출 category name to a 연말정산 deduction bucket. The user can rename
// categories freely, so the stage falls back to keyword matching too — this
// table only covers the default category set.
export const TAX_CATEGORY_BUCKET = {
  '의료/건강': '의료비',
  보험: '보장성보험',
  교육: '교육비',
  '기부/후원': '기부금',
  '주거/관리': '월세',
}

// Keyword fallbacks for user-renamed categories.
export const TAX_CATEGORY_KEYWORDS = [
  { bucket: '의료비', keywords: ['의료', '병원', '약국', '치과'] },
  { bucket: '보장성보험', keywords: ['보험', '보장성'] },
  { bucket: '교육비', keywords: ['교육', '학원', '등록금', '학비'] },
  { bucket: '기부금', keywords: ['기부', '후원'] },
  { bucket: '월세', keywords: ['월세', '임차'] },
  { bucket: '전통시장', keywords: ['전통시장', '시장'] },
  { bucket: '대중교통', keywords: ['대중교통', '지하철', '버스'] },
  { bucket: '도서공연', keywords: ['도서', '신문', '공연', '박물관', '미술관', '영화', '수영장', '헬스', '체력단련'] },
]
