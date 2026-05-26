// Manual-input assist mapping tables.
// Update these arrays when category names, payment method kinds, or paste
// keywords change. The parser in inputAssist.js reads only this table.

export const TRANSACTION_CATEGORY_KEYWORDS = {
  수입: [
    { category: '급여', keywords: ['급여', '월급', '월급날', 'salary', 'payroll'] },
    { category: '보너스', keywords: ['보너스', '상여', '성과급', '인센티브'] },
    { category: '사업소득', keywords: ['사업', '매출', '외주', '프리랜서', '용역'] },
    { category: '이자/배당', keywords: ['이자', '배당', '분배금', '예금이자'] },
    { category: '용돈', keywords: ['용돈', '지원금'] },
    { category: '환급', keywords: ['환급', '캐시백', '취소', '환불', '세금환급'] },
    { category: '중고판매', keywords: ['중고', '판매', '당근', '번개장터', '중고나라'] },
  ],
  지출: [
    { category: '식비', keywords: ['식비', '점심', '저녁', '아침', '카페', '커피', '식당', '배달', '편의점', '마트'] },
    { category: '주거/관리', keywords: ['월세', '관리비', '전기', '가스', '수도', '주거', '임대료'] },
    { category: '교통', keywords: ['교통', '버스', '지하철', '택시', '주유', '주차', '하이패스', '기차'] },
    { category: '통신', keywords: ['통신', '휴대폰', '핸드폰', '인터넷', '요금제', '알뜰폰'] },
    { category: '생활용품', keywords: ['생활', '생필품', '쿠팡', '다이소', '가전', '가구', '청소'] },
    { category: '의료/건강', keywords: ['병원', '약국', '의료', '건강', '치과', '검진', '운동', '헬스'] },
    { category: '문화/여가', keywords: ['영화', '공연', '여행', '숙박', '게임', '구독', '넷플릭스', '유튜브'] },
    { category: '교육', keywords: ['교육', '학원', '강의', '책', '도서', '수업', '등록금'] },
    { category: '경조사', keywords: ['축의', '부의', '경조', '선물', '후원', '기부'] },
    { category: '보험', keywords: ['보험', '실손', '자동차보험', '화재보험'] },
  ],
}

export const PAYMENT_METHOD_KEYWORDS = [
  { kind: '체크카드', keywords: ['체크', '체크카드', 'debit'] },
  { kind: '신용카드', keywords: ['신용', '신용카드', '카드승인', '일시불', '할부', 'credit'] },
  { kind: '현금', keywords: ['현금', 'cash'] },
  { kind: '계좌', keywords: ['계좌', '이체', '송금', '자동이체', '출금'] },
  { kind: '간편결제', keywords: ['페이', '카카오페이', '네이버페이', '토스', 'pay'] },
]

export const DATE_KEYWORDS = [
  { keyword: '오늘', offsetDays: 0 },
  { keyword: '어제', offsetDays: -1 },
  { keyword: '그제', offsetDays: -2 },
  { keyword: '내일', offsetDays: 1 },
]
