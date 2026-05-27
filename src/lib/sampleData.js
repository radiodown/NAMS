import {
  STAGE_TABS,
  buildDefaultDoc,
  defaultCategories,
  defaultFixedSectionSettings,
} from './schema'
import { todayStr } from './format'

const pad = (n) => String(n).padStart(2, '0')

function addMonths(date, offset) {
  const [year, month, day] = String(date || todayStr()).split('-').map(Number)
  const base = new Date(year || new Date().getFullYear(), (month || 1) - 1 + offset, 1)
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(Math.min(day || 1, lastDay))}`
}

function monthLabel(today, offset = 0) {
  return addMonths(`${String(today).slice(0, 7)}-01`, offset).slice(0, 7)
}

function dateInMonth(month, day) {
  const [year, monthNum] = String(month || '').split('-').map(Number)
  const lastDay = new Date(year || new Date().getFullYear(), monthNum || 1, 0).getDate()
  return `${month}-${pad(Math.min(Math.max(Number(day) || 1, 1), lastDay))}`
}

function entry(id, date, category, amount, memo, extra = {}) {
  return { id, date, category, amount, memo, ...extra }
}

function fixedRecord(template, month, extra = {}) {
  return {
    id: `${template.id}-record-${month}`,
    month,
    sourceId: template.id,
    name: template.name,
    category: template.category,
    amount: template.amount,
    day: template.day,
    color: template.color,
    paymentMethodId: template.paymentMethodId,
    paymentMethod: template.paymentMethod,
    ...extra,
  }
}

export function buildSampleDocument(today = todayStr()) {
  const doc = buildDefaultDoc()
  const currentMonth = monthLabel(today)
  const previousMonths = [5, 4, 3, 2, 1].map((offset) => monthLabel(today, -offset))
  const thisYear = Number(today.slice(0, 4)) || new Date().getFullYear()

  const paymentMethods = [
    {
      id: 'sample-pay-hyundai',
      name: '현대카드 M Boost',
      kind: '신용카드',
      cardProductName: '현대카드 M Boost',
      cardProductIssuer: '현대카드',
      annualFee: 30000,
      monthlyTarget: 500000,
      monthlyLimit: 2000000,
    },
    {
      id: 'sample-pay-shinhan',
      name: '신한 Deep Dream',
      kind: '신용카드',
      cardProductName: '신한카드 Deep Dream',
      cardProductIssuer: '신한카드',
      annualFee: 10000,
      monthlyTarget: 300000,
      monthlyLimit: 1500000,
    },
    { id: 'sample-pay-toss', name: '토스뱅크 체크', kind: '체크카드', monthlyLimit: 800000 },
    { id: 'sample-pay-kakao', name: '카카오페이', kind: '간편결제', monthlyLimit: 500000 },
    { id: 'sample-pay-cash', name: '현금', kind: '현금' },
  ]
  const payName = (id) => paymentMethods.find((method) => method.id === id)?.name || '미지정'

  const fixedIncomeTemplates = [
    {
      id: 'sample-fixed-income-salary',
      name: 'NAMS Labs 급여',
      category: '급여',
      amount: 5200000,
      day: 25,
      color: '#16a34a',
    },
    {
      id: 'sample-fixed-income-rent',
      name: '오피스텔 월세 수입',
      category: '월세수입',
      amount: 850000,
      day: 5,
      color: '#0891b2',
    },
    {
      id: 'sample-fixed-income-dividend',
      name: '월 배당 ETF',
      category: '이자/배당',
      amount: 185000,
      day: 15,
      color: '#7c3aed',
    },
  ]

  const fixedExpenseTemplates = [
    {
      id: 'sample-fixed-expense-rent',
      name: '월세 및 관리비',
      category: '주거/관리',
      amount: 1180000,
      day: 2,
      color: '#dc2626',
      paymentMethodId: 'sample-pay-shinhan',
      paymentMethod: payName('sample-pay-shinhan'),
    },
    {
      id: 'sample-fixed-expense-phone',
      name: '휴대폰/인터넷',
      category: '통신',
      amount: 129000,
      day: 12,
      color: '#2563eb',
      paymentMethodId: 'sample-pay-hyundai',
      paymentMethod: payName('sample-pay-hyundai'),
    },
    {
      id: 'sample-fixed-expense-insurance',
      name: '실손보험',
      category: '보험',
      amount: 142000,
      day: 18,
      color: '#0f766e',
      paymentMethodId: 'sample-pay-toss',
      paymentMethod: payName('sample-pay-toss'),
    },
    {
      id: 'sample-fixed-expense-streaming',
      name: '구독 서비스 묶음',
      category: '문화/여가',
      amount: 59000,
      day: 20,
      color: '#d97706',
      paymentMethodId: 'sample-pay-kakao',
      paymentMethod: payName('sample-pay-kakao'),
    },
    {
      id: 'sample-fixed-expense-loan',
      name: '자동차 할부',
      category: '교통',
      amount: 438000,
      day: 28,
      color: '#64748b',
      paymentMethodId: 'sample-pay-hyundai',
      paymentMethod: payName('sample-pay-hyundai'),
      loanMethod: '원리금균등',
      loanPrincipal: 22000000,
      loanRate: 5.2,
      loanMonths: 60,
      loanRound: 19,
      loanGraceMonths: '',
    },
  ]

  doc.settings = {
    theme: 'light',
    stages: STAGE_TABS.map((name) => ({ name, visible: true })),
    fixedSections: defaultFixedSectionSettings(),
    taxSettlement: {
      year: thisYear,
      manualSalary: 72000000,
      dependents: 2,
      children: 1,
      isHomeless: true,
      extraMedical: 420000,
      extraEducation: 600000,
      extraDonation: 300000,
      extraInsurance: 960000,
      monthlyRent: 650000,
      prepaidTax: 5200000,
      marriageCredit: false,
    },
  }

  doc.stages.income = {
    categories: [...defaultCategories('수입'), '월세수입', '프로젝트', '성과급'],
    entries: [
      entry('sample-income-bonus', dateInMonth(currentMonth, 10), '성과급', 1800000, '상반기 OKR 보너스'),
      entry('sample-income-project', dateInMonth(currentMonth, 13), '프로젝트', 950000, '브랜드 컨설팅 잔금'),
      entry('sample-income-interest', dateInMonth(currentMonth, 21), '이자/배당', 76000, '파킹통장 이자'),
      entry('sample-income-used', dateInMonth(currentMonth, 24), '중고판매', 220000, '카메라 렌즈 판매'),
      entry('sample-income-refund', dateInMonth(previousMonths[4], 7), '환급', 312000, '건강보험 정산 환급'),
      entry('sample-income-side-1', dateInMonth(previousMonths[3], 16), '프로젝트', 720000, '데이터 대시보드 구축'),
      entry('sample-income-gift', dateInMonth(previousMonths[2], 4), '용돈', 200000, '명절 용돈'),
      entry('sample-income-dividend-2', dateInMonth(previousMonths[1], 18), '이자/배당', 134000, '해외 ETF 배당'),
    ],
    fixed: {
      templates: fixedIncomeTemplates,
      records: previousMonths.flatMap((month, index) =>
        fixedIncomeTemplates.map((template) =>
          fixedRecord(template, month, {
            amount:
              template.id === 'sample-fixed-income-salary'
                ? template.amount + (index % 2 === 0 ? 120000 : 0)
                : template.amount,
          })
        )
      ),
      closedMonths: previousMonths,
      lastActiveMonth: currentMonth,
    },
  }

  doc.stages.expense = {
    categories: [
      ...defaultCategories('지출'),
      '전통시장',
      '대중교통',
      '도서공연',
      '기부금',
      '운동',
    ],
    paymentMethods,
    entries: [
      entry('sample-expense-grocery', dateInMonth(currentMonth, 3), '식비', 126000, '주간 장보기', {
        paymentMethodId: 'sample-pay-toss',
        paymentMethod: payName('sample-pay-toss'),
      }),
      entry('sample-expense-market', dateInMonth(currentMonth, 4), '전통시장', 73000, '반찬/과일', {
        paymentMethodId: 'sample-pay-cash',
        paymentMethod: payName('sample-pay-cash'),
      }),
      entry('sample-expense-coffee', dateInMonth(currentMonth, 5), '식비', 18500, '팀 커피', {
        paymentMethodId: 'sample-pay-kakao',
        paymentMethod: payName('sample-pay-kakao'),
      }),
      entry('sample-expense-transit', dateInMonth(currentMonth, 6), '대중교통', 64500, '교통카드 충전', {
        paymentMethodId: 'sample-pay-toss',
        paymentMethod: payName('sample-pay-toss'),
      }),
      entry('sample-expense-medical', dateInMonth(currentMonth, 8), '의료/건강', 118000, '치과 정기검진', {
        paymentMethodId: 'sample-pay-shinhan',
        paymentMethod: payName('sample-pay-shinhan'),
      }),
      entry('sample-expense-book', dateInMonth(currentMonth, 9), '도서공연', 54000, '서점/전시 티켓', {
        paymentMethodId: 'sample-pay-hyundai',
        paymentMethod: payName('sample-pay-hyundai'),
      }),
      entry('sample-expense-dining', dateInMonth(currentMonth, 11), '식비', 89000, '친구 모임', {
        paymentMethodId: 'sample-pay-hyundai',
        paymentMethod: payName('sample-pay-hyundai'),
      }),
      entry('sample-expense-fitness', dateInMonth(currentMonth, 14), '운동', 99000, '필라테스 이용권', {
        paymentMethodId: 'sample-pay-shinhan',
        paymentMethod: payName('sample-pay-shinhan'),
      }),
      entry('sample-expense-education', dateInMonth(currentMonth, 17), '교육', 350000, 'AI 세미나 등록', {
        paymentMethodId: 'sample-pay-hyundai',
        paymentMethod: payName('sample-pay-hyundai'),
      }),
      entry('sample-expense-donation', dateInMonth(currentMonth, 19), '기부금', 50000, '정기 후원', {
        paymentMethodId: 'sample-pay-kakao',
        paymentMethod: payName('sample-pay-kakao'),
      }),
      entry('sample-expense-living', dateInMonth(currentMonth, 22), '생활용품', 142000, '침구 교체', {
        paymentMethodId: 'sample-pay-shinhan',
        paymentMethod: payName('sample-pay-shinhan'),
      }),
      entry('sample-expense-trip', dateInMonth(currentMonth, 25), '문화/여가', 286000, '강릉 1박 여행', {
        paymentMethodId: 'sample-pay-hyundai',
        paymentMethod: payName('sample-pay-hyundai'),
      }),
      ...previousMonths.flatMap((month, index) => [
        entry(`sample-expense-prev-food-${month}`, dateInMonth(month, 6), '식비', 310000 + index * 17000, '월간 식비', {
          paymentMethodId: 'sample-pay-toss',
          paymentMethod: payName('sample-pay-toss'),
        }),
        entry(`sample-expense-prev-life-${month}`, dateInMonth(month, 14), '생활용품', 120000 + index * 9000, '생활비 정산', {
          paymentMethodId: 'sample-pay-shinhan',
          paymentMethod: payName('sample-pay-shinhan'),
        }),
        entry(`sample-expense-prev-culture-${month}`, dateInMonth(month, 23), '문화/여가', 86000 + index * 15000, '공연/모임', {
          paymentMethodId: 'sample-pay-hyundai',
          paymentMethod: payName('sample-pay-hyundai'),
        }),
      ]),
    ],
    fixed: {
      templates: fixedExpenseTemplates,
      records: previousMonths.flatMap((month) =>
        fixedExpenseTemplates.map((template) => fixedRecord(template, month))
      ),
      closedMonths: previousMonths,
      lastActiveMonth: currentMonth,
    },
  }

  doc.stages.investment = {
    products: [
      {
        id: 'sample-invest-deposit-1',
        kind: '예금',
        name: '비상금 정기예금',
        date: addMonths(today, -8),
        principal: 18000000,
        rate: 3.7,
        months: 12,
        method: '단리',
        color: '#0891b2',
        taxBenefit: '없음',
      },
      {
        id: 'sample-invest-savings-1',
        kind: '적금',
        name: '청년도약계좌',
        date: addMonths(today, -9),
        monthly: 700000,
        rate: 5.2,
        months: 60,
        round: 10,
        method: '단리',
        color: '#4f46e5',
        taxBenefit: '청년도약계좌',
      },
      {
        id: 'sample-invest-savings-2',
        kind: '적금',
        name: '주택청약종합저축',
        date: addMonths(today, -36),
        monthly: 200000,
        rate: 2.8,
        months: 120,
        round: 37,
        method: '단리',
        color: '#7c3aed',
        taxBenefit: '주택청약',
      },
      {
        id: 'sample-invest-stock-1',
        kind: '주식',
        name: '삼성전자',
        date: addMonths(today, -14),
        shares: 120,
        buyPrice: 68000,
        currentPrice: 80500,
        currency: 'KRW',
        quoteCurrency: 'KRW',
        quoteSymbol: '005930.KS',
        quoteTime: `${today}T09:00:00+09:00`,
        color: '#d97706',
        taxBenefit: 'ISA',
      },
      {
        id: 'sample-invest-stock-2',
        kind: '주식',
        name: 'Apple',
        date: addMonths(today, -20),
        shares: 18,
        buyPrice: 172,
        currentPrice: 196,
        currency: 'USD',
        quoteCurrency: 'USD',
        quoteSymbol: 'AAPL',
        exchangeRate: 1360,
        exchangeRateTime: `${today}T09:00:00+09:00`,
        quoteTime: `${today}T09:00:00+09:00`,
        color: '#2563eb',
        taxBenefit: '없음',
      },
      {
        id: 'sample-invest-stock-3',
        kind: '주식',
        name: 'KODEX 200',
        date: addMonths(today, -18),
        shares: 80,
        buyPrice: 36500,
        currentPrice: 39200,
        currency: 'KRW',
        quoteCurrency: 'KRW',
        quoteSymbol: '069500.KS',
        quoteTime: `${today}T09:00:00+09:00`,
        color: '#16a34a',
        taxBenefit: 'ISA',
      },
      {
        id: 'sample-invest-asset-cash',
        kind: '자산',
        assetType: '현금성자산',
        name: '파킹통장 여유자금',
        date: addMonths(today, -2),
        assetValue: 7200000,
        assetCost: 7200000,
        color: '#0f766e',
        taxBenefit: '없음',
      },
      {
        id: 'sample-invest-bitcoin-1',
        kind: '비트코인',
        name: '비트코인',
        date: addMonths(today, -11),
        quantity: 0.042,
        buyPrice: 93000000,
        currentPrice: 115900000,
        currency: 'KRW',
        quoteCurrency: 'KRW',
        quoteSymbol: 'BTC-KRW',
        quoteTime: `${today}T09:00:00+09:00`,
        color: '#f97316',
        taxBenefit: '없음',
      },
      {
        id: 'sample-invest-asset-gold',
        kind: '자산',
        assetType: '금',
        name: '골드바 10g',
        date: addMonths(today, -17),
        assetValue: 1320000,
        assetCost: 1180000,
        color: '#ca8a04',
        taxBenefit: '없음',
      },
    ],
  }

  doc.stages.mockInvest = {
    portfolio: {
      startingCash: 10000000,
      cash: 10000000,
      realizedPnL: 0,
      createdAt: '',
      positions: [],
      trades: [],
    },
  }

  return doc
}
