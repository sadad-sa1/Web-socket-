function finite(value) {
  return Number.isFinite(value) ? value : null;
}

export function percentChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function spreadMetrics(bid, ask) {
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) {
    return { spread: null, spreadBps: null, midpoint: null };
  }
  const spread = ask - bid;
  const midpoint = (ask + bid) / 2;
  return {
    spread,
    midpoint,
    spreadBps: midpoint > 0 ? (spread / midpoint) * 10000 : null,
  };
}

export function quoteImbalance(bidSize, askSize) {
  if (!Number.isFinite(bidSize) || !Number.isFinite(askSize)) return null;
  const total = bidSize + askSize;
  if (total <= 0) return null;
  return (bidSize - askSize) / total;
}

function saturate(value, scale) {
  if (!Number.isFinite(value)) return 0;
  return Math.tanh(value / scale);
}

export function calculateMomentum({ change1mPct, change5mPct, imbalance }) {
  const oneMinute = saturate(change1mPct, 0.35) * 20;
  const fiveMinute = saturate(change5mPct, 0.8) * 20;
  const book = Number.isFinite(imbalance) ? Math.max(-1, Math.min(1, imbalance)) * 10 : 0;
  const score = Math.max(0, Math.min(100, 50 + oneMinute + fiveMinute + book));

  let regime = 'neutral';
  if (score >= 70) regime = 'strong_up';
  else if (score >= 58) regime = 'up';
  else if (score <= 30) regime = 'strong_down';
  else if (score <= 42) regime = 'down';

  return {
    score: Number(score.toFixed(2)),
    regime,
    components: {
      oneMinute: Number(oneMinute.toFixed(2)),
      fiveMinute: Number(fiveMinute.toFixed(2)),
      orderBook: Number(book.toFixed(2)),
    },
  };
}

export function compactNumber(value, digits = 6) {
  const n = finite(value);
  return n == null ? null : Number(n.toFixed(digits));
}
