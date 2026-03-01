---
name: finance-stocks
description: Use this skill when the user asks for stock prices, ticker quotes, historical performance, simple trend checks, or comparisons between public companies/tickers.
version: 1.0.0
---

# Finance Stocks Skill

This skill is adapted from the open plugin pattern used in Anthropic's `claude-plugins-official`
repository and tailored for this Copilot SDK backend.

Use the built-in tools:
- `get_stock_quote` for latest quote data
- `get_stock_history` for recent daily closing data

## Workflow

1. Normalize to a valid ticker symbol (for example `AAPL`, `MSFT`, `TSLA`).
2. Fetch data with a tool first; do not guess prices.
3. Present results with:
   - current price
   - daily change and percent (when available)
   - data provider and timestamp
4. If historical data is requested, summarize trend direction and show key points (latest, highest, lowest in window).

## Guardrails

- Treat all outputs as informational only, not investment advice.
- If a provider fails, retry with fallback providers via tool defaults.
- Mention when source is delayed market data.

