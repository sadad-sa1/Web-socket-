import {
  calculateMomentum,
  compactNumber,
  percentChange,
  quoteImbalance,
  spreadMetrics,
} from './metrics.mjs';

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const HISTORY_RETENTION_MS = 6 * 60 * 1000;

function toMillis(timestamp) {
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : Date.now();
}

function valueAtOrBefore(history, cutoffMs) {
  if (history.length === 0) return null;
  let candidate = history[0];
  for (const point of history) {
    if (point.t <= cutoffMs) candidate = point;
    else break;
  }
  return candidate?.p ?? history[0]?.p ?? null;
}

function emptySymbol(symbol) {
  return {
    symbol,
    trade: null,
    quote: null,
    bar: null,
    history: [],
    lastUpdateMs: 0,
  };
}

export class MarketState {
  #symbols = new Map();

  get(symbol) {
    return this.#symbols.get(symbol) ?? null;
  }

  snapshot(symbol) {
    const state = this.#symbols.get(symbol);
    return state ? this.#derive(state) : null;
  }

  snapshots(symbols = null) {
    const target = symbols ?? [...this.#symbols.keys()];
    return target.map((symbol) => this.snapshot(symbol)).filter(Boolean);
  }

  apply(message) {
    const symbol = message?.S;
    if (typeof symbol !== 'string' || !symbol) return null;
    let state = this.#symbols.get(symbol);
    if (!state) {
      state = emptySymbol(symbol);
      this.#symbols.set(symbol, state);
    }

    if (message.T === 't') this.#applyTrade(state, message);
    else if (message.T === 'q') this.#applyQuote(state, message);
    else if (message.T === 'b' || message.T === 'u') this.#applyBar(state, message);
    else return null;

    state.lastUpdateMs = Date.now();
    return this.#derive(state);
  }

  #applyTrade(state, message) {
    const price = Number(message.p);
    const size = Number(message.s);
    const timestamp = message.t ?? new Date().toISOString();
    state.trade = {
      price: Number.isFinite(price) ? price : null,
      size: Number.isFinite(size) ? size : null,
      exchange: message.x ?? null,
      conditions: Array.isArray(message.c) ? message.c : [],
      timestamp,
    };

    if (Number.isFinite(price)) {
      const t = toMillis(timestamp);
      state.history.push({ t, p: price });
      const min = t - HISTORY_RETENTION_MS;
      while (state.history.length > 1 && state.history[0].t < min) state.history.shift();
    }
  }

  #applyQuote(state, message) {
    const bid = Number(message.bp);
    const ask = Number(message.ap);
    const bidSize = Number(message.bs);
    const askSize = Number(message.as);
    state.quote = {
      bid: Number.isFinite(bid) ? bid : null,
      ask: Number.isFinite(ask) ? ask : null,
      bidSize: Number.isFinite(bidSize) ? bidSize : null,
      askSize: Number.isFinite(askSize) ? askSize : null,
      bidExchange: message.bx ?? null,
      askExchange: message.ax ?? null,
      timestamp: message.t ?? new Date().toISOString(),
    };
  }

  #applyBar(state, message) {
    const fields = ['o', 'h', 'l', 'c', 'v', 'n', 'vw'];
    const mapped = Object.fromEntries(
      fields.map((field) => {
        const n = Number(message[field]);
        return [field, Number.isFinite(n) ? n : null];
      }),
    );
    state.bar = {
      open: mapped.o,
      high: mapped.h,
      low: mapped.l,
      close: mapped.c,
      volume: mapped.v,
      tradeCount: mapped.n,
      vwap: mapped.vw,
      timestamp: message.t ?? new Date().toISOString(),
      updated: message.T === 'u',
    };
  }

  #derive(state) {
    const current = state.trade?.price ?? state.bar?.close ?? null;
    const now = state.history.at(-1)?.t ?? Date.now();
    const oneMinutePrice = valueAtOrBefore(state.history, now - 60_000);
    const fiveMinutePrice = valueAtOrBefore(state.history, now - FIVE_MINUTES_MS);
    const change1mPct = percentChange(current, oneMinutePrice);
    const change5mPct = percentChange(current, fiveMinutePrice);
    const imbalance = quoteImbalance(state.quote?.bidSize, state.quote?.askSize);
    const spread = spreadMetrics(state.quote?.bid, state.quote?.ask);
    const momentum = calculateMomentum({ change1mPct, change5mPct, imbalance });

    return {
      symbol: state.symbol,
      price: compactNumber(current),
      trade: state.trade,
      quote: state.quote,
      bar: state.bar,
      analytics: {
        change1mPct: compactNumber(change1mPct, 4),
        change5mPct: compactNumber(change5mPct, 4),
        quoteImbalance: compactNumber(imbalance, 4),
        spread: compactNumber(spread.spread),
        spreadBps: compactNumber(spread.spreadBps, 3),
        midpoint: compactNumber(spread.midpoint),
        momentum,
      },
      updatedAt: new Date(state.lastUpdateMs || Date.now()).toISOString(),
    };
  }
}
