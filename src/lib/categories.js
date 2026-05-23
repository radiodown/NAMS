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
  환율: { kind: '환율', color: '#059669', desc: '원하는 통화 환율을 조회하고 해외 주식 평가에 사용합니다' },
}

export const INVEST_KINDS = ['예금', '적금', '주식']

export const INVEST_COLOR = '#0e7490'
export const SUMMARY_COLOR = '#7c3aed'
