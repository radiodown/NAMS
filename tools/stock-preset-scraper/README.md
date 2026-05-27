# Stock Preset Scraper

투자 stage의 주식/ETF 검색에 쓰는 로컬 프리셋 DB를 생성하는 도구입니다. 직접 관리할 핵심 별칭은 seed 파일에 두고, 국내 종목/ETF 목록은 네이버 모바일 증권 API에서 수집해 합칩니다.

## Usage

```bash
npm run stock:presets
```

수집 범위를 조정하려면:

```bash
npm run stock:presets -- --kospi-pages=5 --kosdaq-pages=5 --etf-pages=10
```

## Inputs

- `tools/stock-preset-scraper/seed-presets.json`: 직접 관리하는 핵심 프리셋과 검색 별칭

## Outputs

- `data/stock-presets/stock-search-presets.json`: 수집 메타데이터를 포함한 원본 JSON
- `src/lib/stockSearchPresets.generated.js`: 앱에서 import하는 generated 프리셋

## Notes

- generated 파일은 직접 수정하지 않고 `npm run stock:presets`로 다시 만듭니다.
- seed의 `keywords`는 검색 별칭으로 유지되고, 스크래핑 결과의 현재가/거래소/타입 정보가 병합됩니다.
- 네이버 목록 순위는 `rank`로 저장되어 넓은 검색어에서 대표 종목이 먼저 보이도록 사용됩니다.
