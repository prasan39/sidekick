# Provider Notes

Providers are tried in this order by default:
1. `twelvedata`
2. `fmp`
3. `alphavantage`
4. `stooq` (no-key fallback, delayed)

## Environment variables

- `TWELVE_DATA_API_KEY`
- `FMP_API_KEY`
- `ALPHA_VANTAGE_API_KEY`

If no keys are configured, quotes/history still work through Stooq fallback.

## Known tradeoffs

- Free tiers usually have request/day and request/min caps.
- Stooq data can be delayed and may be US ticker focused (`AAPL` maps to `aapl.us`).
- Historical windows are capped to keep responses quick (`5` to `120` days).

