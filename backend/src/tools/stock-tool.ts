type Provider = 'twelvedata' | 'fmp' | 'alphavantage' | 'stooq';

const HTTP_TIMEOUT_MS = 12000;

export interface StockQuote {
  symbol: string;
  price: number;
  currency?: string;
  change?: number;
  changePercent?: number;
  timestamp?: string;
  provider: Provider;
  sourceNote?: string;
}

export interface HistoryPoint {
  date: string;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

export interface StockHistory {
  symbol: string;
  points: HistoryPoint[];
  provider: Provider;
  sourceNote?: string;
}

function sanitizeSymbol(symbol: string): string {
  const cleaned = symbol.trim().toUpperCase();
  if (!cleaned) throw new Error('Symbol is required');
  return cleaned;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').replace('%', '').trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toStooqSymbol(symbol: string): string {
  const s = symbol.trim().toLowerCase();
  if (s.includes('.')) return s;
  return `${s}.us`;
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'sidekick-terminal/1.0' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const text = await fetchText(url);
  return JSON.parse(text) as Record<string, unknown>;
}

function parseCsv(csv: string): Array<Record<string, string>> {
  const lines = csv
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim());
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = cols[idx] ?? '';
    });
    rows.push(row);
  }

  return rows;
}

async function quoteFromTwelveData(symbol: string): Promise<StockQuote> {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error('TWELVE_DATA_API_KEY missing');
  const json = await fetchJson(
    `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`,
  );
  if (typeof json.status === 'string' && json.status.toLowerCase() === 'error') {
    throw new Error(String(json.message || 'Twelve Data returned an error'));
  }

  const price = toNumber(json.close) ?? toNumber(json.price);
  if (!price) throw new Error('No quote price returned by Twelve Data');

  return {
    symbol,
    price,
    currency: typeof json.currency === 'string' ? json.currency : undefined,
    change: toNumber(json.change),
    changePercent: toNumber(json.percent_change),
    timestamp: typeof json.datetime === 'string' ? json.datetime : undefined,
    provider: 'twelvedata',
  };
}

async function quoteFromFmp(symbol: string): Promise<StockQuote> {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error('FMP_API_KEY missing');
  const text = await fetchText(
    `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(symbol)}?apikey=${encodeURIComponent(key)}`,
  );
  const json = JSON.parse(text) as unknown;
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error('No quote returned by FMP');
  }
  const row = json[0] as Record<string, unknown>;
  const price = toNumber(row.price);
  if (!price) throw new Error('Invalid quote from FMP');

  return {
    symbol,
    price,
    change: toNumber(row.change),
    changePercent: toNumber(row.changesPercentage),
    timestamp: typeof row.timestamp === 'number' ? new Date(row.timestamp * 1000).toISOString() : undefined,
    provider: 'fmp',
  };
}

async function quoteFromAlphaVantage(symbol: string): Promise<StockQuote> {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) throw new Error('ALPHA_VANTAGE_API_KEY missing');
  const json = await fetchJson(
    `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`,
  );
  const quote = json['Global Quote'] as Record<string, unknown> | undefined;
  if (!quote) throw new Error('No quote returned by Alpha Vantage');

  const price = toNumber(quote['05. price']);
  if (!price) throw new Error('Invalid quote from Alpha Vantage');

  return {
    symbol,
    price,
    change: toNumber(quote['09. change']),
    changePercent: toNumber(quote['10. change percent']),
    timestamp: typeof quote['07. latest trading day'] === 'string' ? quote['07. latest trading day'] : undefined,
    provider: 'alphavantage',
  };
}

async function quoteFromStooq(symbol: string): Promise<StockQuote> {
  const stooqSymbol = toStooqSymbol(symbol);
  const csv = await fetchText(
    `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=sd2t2ohlcv&h&e=csv`,
  );
  const rows = parseCsv(csv);
  if (rows.length === 0) throw new Error('No quote returned by Stooq');

  const row = rows[0];
  const close = toNumber(row.Close);
  if (!close) throw new Error('Invalid quote from Stooq');

  const open = toNumber(row.Open);
  const change = open && open !== 0 ? close - open : undefined;
  const changePercent = open && open !== 0 ? ((close - open) / open) * 100 : undefined;

  return {
    symbol,
    price: close,
    change,
    changePercent,
    timestamp: `${row.Date || ''} ${row.Time || ''}`.trim() || undefined,
    provider: 'stooq',
    sourceNote: 'Delayed data (free source).',
  };
}

async function historyFromTwelveData(symbol: string, days: number): Promise<StockHistory> {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error('TWELVE_DATA_API_KEY missing');
  const json = await fetchJson(
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=${days}&apikey=${encodeURIComponent(key)}`,
  );
  if (typeof json.status === 'string' && json.status.toLowerCase() === 'error') {
    throw new Error(String(json.message || 'Twelve Data returned an error'));
  }
  const values = Array.isArray(json.values) ? (json.values as Array<Record<string, unknown>>) : [];
  const points = values
    .map((v) => ({
      date: String(v.datetime || ''),
      close: toNumber(v.close) || NaN,
      open: toNumber(v.open),
      high: toNumber(v.high),
      low: toNumber(v.low),
      volume: toNumber(v.volume),
    }))
    .filter((p) => p.date && Number.isFinite(p.close));

  if (points.length === 0) throw new Error('No historical points from Twelve Data');
  return { symbol, points, provider: 'twelvedata' };
}

async function historyFromFmp(symbol: string, days: number): Promise<StockHistory> {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error('FMP_API_KEY missing');
  const json = await fetchJson(
    `https://financialmodelingprep.com/api/v3/historical-price-full/${encodeURIComponent(symbol)}?timeseries=${days}&apikey=${encodeURIComponent(key)}`,
  );
  const historical = Array.isArray(json.historical) ? (json.historical as Array<Record<string, unknown>>) : [];
  const points = historical
    .map((v) => ({
      date: String(v.date || ''),
      close: toNumber(v.close) || NaN,
      open: toNumber(v.open),
      high: toNumber(v.high),
      low: toNumber(v.low),
      volume: toNumber(v.volume),
    }))
    .filter((p) => p.date && Number.isFinite(p.close));

  if (points.length === 0) throw new Error('No historical points from FMP');
  return { symbol, points, provider: 'fmp' };
}

async function historyFromAlphaVantage(symbol: string, days: number): Promise<StockHistory> {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) throw new Error('ALPHA_VANTAGE_API_KEY missing');
  const json = await fetchJson(
    `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${encodeURIComponent(key)}`,
  );
  const series = json['Time Series (Daily)'] as Record<string, Record<string, string>> | undefined;
  if (!series) throw new Error('No historical points from Alpha Vantage');

  const points = Object.entries(series)
    .map(([date, v]) => ({
      date,
      close: toNumber(v['4. close']) || NaN,
      open: toNumber(v['1. open']),
      high: toNumber(v['2. high']),
      low: toNumber(v['3. low']),
      volume: toNumber(v['5. volume']),
    }))
    .filter((p) => Number.isFinite(p.close))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, days);

  if (points.length === 0) throw new Error('No historical points from Alpha Vantage');
  return { symbol, points, provider: 'alphavantage' };
}

async function historyFromStooq(symbol: string, days: number): Promise<StockHistory> {
  const stooqSymbol = toStooqSymbol(symbol);
  const csv = await fetchText(`https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=d`);
  const rows = parseCsv(csv);
  const points = rows
    .map((row) => ({
      date: row.Date || '',
      close: toNumber(row.Close) || NaN,
      open: toNumber(row.Open),
      high: toNumber(row.High),
      low: toNumber(row.Low),
      volume: toNumber(row.Volume),
    }))
    .filter((p) => p.date && Number.isFinite(p.close))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, days);

  if (points.length === 0) throw new Error('No historical points from Stooq');
  return { symbol, points, provider: 'stooq', sourceNote: 'Delayed data (free source).' };
}

export async function getStockQuote(
  symbolInput: string,
  preferredProvider?: Provider,
): Promise<StockQuote> {
  const symbol = sanitizeSymbol(symbolInput);

  const orderedProviders: Provider[] = preferredProvider
    ? [preferredProvider]
    : ['twelvedata', 'fmp', 'alphavantage', 'stooq'];

  const errors: string[] = [];
  for (const provider of orderedProviders) {
    try {
      if (provider === 'twelvedata') return await quoteFromTwelveData(symbol);
      if (provider === 'fmp') return await quoteFromFmp(symbol);
      if (provider === 'alphavantage') return await quoteFromAlphaVantage(symbol);
      return await quoteFromStooq(symbol);
    } catch (error) {
      errors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Unable to fetch quote for ${symbol}. Attempts: ${errors.join(' | ')}`);
}

export async function getStockHistory(
  symbolInput: string,
  daysInput = 30,
  preferredProvider?: Provider,
): Promise<StockHistory> {
  const symbol = sanitizeSymbol(symbolInput);
  const days = Math.min(Math.max(Number(daysInput) || 30, 5), 120);

  const orderedProviders: Provider[] = preferredProvider
    ? [preferredProvider]
    : ['twelvedata', 'fmp', 'alphavantage', 'stooq'];

  const errors: string[] = [];
  for (const provider of orderedProviders) {
    try {
      if (provider === 'twelvedata') return await historyFromTwelveData(symbol, days);
      if (provider === 'fmp') return await historyFromFmp(symbol, days);
      if (provider === 'alphavantage') return await historyFromAlphaVantage(symbol, days);
      return await historyFromStooq(symbol, days);
    } catch (error) {
      errors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Unable to fetch history for ${symbol}. Attempts: ${errors.join(' | ')}`);
}
