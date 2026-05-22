# Storage Principles

## Goal

Keep persisted state small, portable, and easy to move to accounts or an external database later.

## File Split

- Actual user data is stored in one CSV file.
- Interface and app settings are stored separately in YAML.
- Intermediate calculation results are not persisted.

## CSV Data

The CSV is the single raw data file for domain data.

It may contain records such as:

- income and expense transactions
- fixed expense templates
- investment products
- payment methods and card metadata

The CSV should not contain derived summaries, chart data, totals, rates of change, projections, or cached analysis results.

## YAML Settings

YAML is used for interface and app settings only.

Examples:

- stage visibility
- stage order
- theme mode
- layout preferences
- display preferences
- UI-only category presets or view filters, when they are not transaction data

YAML should not contain transaction records or computed financial results.

## Recalculation Rule

All totals, monthly comparisons, category breakdowns, investment summaries, card usage progress, chart series, and future projections must be recomputed from raw CSV data plus YAML settings whenever needed.

Do not persist calculation caches as source data.

## Future Persistence

The same boundary should survive future sign-up and external database work:

- CSV-equivalent raw domain data maps to user-owned data tables or documents.
- YAML-equivalent settings map to user preference records.
- Derived views remain query or application results.

## Development Policy

This project is still in development.

- Data migration does not need to be considered yet.
- Existing local browser storage can be treated as temporary development cache.
- Current stage UI settings use a YAML-shaped development cache.
- The canonical storage direction is single CSV for raw data and separate YAML for settings.
