import { normalizeSymbol } from './config.mjs';

export const CHANNELS = Object.freeze(['trades', 'quotes', 'bars']);

export function safeJsonParse(raw) {
  try {
    return { ok: true, value: JSON.parse(String(raw)) };
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
}

function normalizeChannels(value) {
  if (value == null) return [...CHANNELS];
  if (!Array.isArray(value)) return null;
  const result = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const channel = item.toLowerCase();
    if (!CHANNELS.includes(channel)) return null;
    if (!seen.has(channel)) {
      seen.add(channel);
      result.push(channel);
    }
  }
  return result;
}

function normalizeSymbols(value, { testMode = false } = {}) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const result = [];
  const seen = new Set();
  for (const item of value) {
    const symbol = normalizeSymbol(item);
    if (!symbol) return null;
    if (testMode && symbol !== 'FAKEPACA') return null;
    if (!seen.has(symbol)) {
      seen.add(symbol);
      result.push(symbol);
    }
  }
  return result;
}

export function parseClientMessage(raw, options = {}) {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok) return parsed;
  const message = parsed.value;
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return { ok: false, error: 'invalid_message' };
  }

  const action = typeof message.action === 'string' ? message.action.toLowerCase() : '';
  if (action === 'ping') return { ok: true, value: { action: 'ping' } };
  if (action === 'snapshot') {
    const symbols = message.symbols == null ? null : normalizeSymbols(message.symbols, options);
    if (message.symbols != null && !symbols) return { ok: false, error: 'invalid_symbols' };
    return { ok: true, value: { action: 'snapshot', symbols } };
  }
  if (!['subscribe', 'unsubscribe'].includes(action)) {
    return { ok: false, error: 'unsupported_action' };
  }

  const symbols = normalizeSymbols(message.symbols, options);
  if (!symbols) return { ok: false, error: 'invalid_symbols' };
  const channels = normalizeChannels(message.channels);
  if (!channels || channels.length === 0) return { ok: false, error: 'invalid_channels' };

  return { ok: true, value: { action, symbols, channels } };
}

export function encodeMessage(type, data = {}) {
  return JSON.stringify({ type, ...data });
}
