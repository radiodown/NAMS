# Card Product Scraper

카드고릴라의 카드 상세 페이지를 sitemap 기반으로 수집해 앱에서 import 가능한 정적 DB를 생성하는 도구입니다. 실시간 연동이 아니라 필요할 때 수동으로 실행하는 반자동 파이프라인입니다.

## Pipeline

```bash
npm run card:scrape
npm run card:normalize
npm run card:rules
npm run card:generate
```

한 번에 실행하려면:

```bash
npm run card:build-db
```

테스트처럼 일부 카드만 수집하려면:

```bash
npm run card:scrape -- --limit=20
```

## Outputs

- `data/card-products/card-gorilla.raw.json`: 카드고릴라 SEO/JSON-LD에서 추출한 raw 데이터
- `data/card-products/card-products.normalized.json`: 앱에서 쓰기 쉬운 카드 상품 DB
- `data/card-products/card-benefit-rules.json`: 예상 혜택 계산을 위한 1차 룰
- `src/lib/cardProductCatalog.generated.js`: 하드코딩 import용 generated catalog
- `src/lib/cardBenefitRules.generated.js`: 하드코딩 import용 generated rules

## Notes

- 수집 대상 URL은 `https://www.card-gorilla.com/sitemap-cards.xml`에서 가져옵니다.
- 상세 HTML 캐시는 `tools/card-scraper/.cache/`에 저장되며 git에는 포함하지 않습니다.
- 혜택 룰은 SEO 요약 문구 기반의 휴리스틱입니다. 계산 신뢰도는 `confidence`로 분리해둡니다.
- 카드 상품 설명 원문 전체 복제가 아니라, 가계부 계산에 필요한 사실 데이터 중심으로 정규화합니다.
