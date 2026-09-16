import WebSocket from 'ws';

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function diff(a, b) {
  return [...a].filter((item) => !b.has(item));
}

function jitter(ms) {
  return Math.max(250, Math.round(ms * (0.85 + Math.random() * 0.3)));
}

export class AlpacaMarketStream {
  #config;
  #logger;
  #onMarketMessage;
  #onStatus;
  #ws = null;
  #stopped = true;
  #authenticated = false;
  #desired = { trades: new Set(), quotes: new Set(), bars: new Set() };
  #active = { trades: new Set(), quotes: new Set(), bars: new Set() };
  #reconnectAttempt = 0;
  #reconnectTimer = null;
  #heartbeatTimer = null;
  #awaitingPong = false;

  constructor({ config, logger, onMarketMessage, onStatus }) {
    this.#config = config;
    this.#logger = logger;
    this.#onMarketMessage = onMarketMessage;
    this.#onStatus = onStatus;
  }

  get status() {
    return {
      connected: this.#ws?.readyState === WebSocket.OPEN,
      authenticated: this.#authenticated,
      url: this.#config.upstreamUrl,
      feed: this.#config.testMode ? 'test' : this.#config.feed,
      active: Object.fromEntries(Object.entries(this.#active).map(([k, v]) => [k, [...v].sort()])),
    };
  }

  start() {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#connect();
  }

  stop() {
    this.#stopped = true;
    clearTimeout(this.#reconnectTimer);
    clearInterval(this.#heartbeatTimer);
    this.#reconnectTimer = null;
    this.#heartbeatTimer = null;
    if (this.#ws) {
      try { this.#ws.close(1000, 'shutdown'); } catch {}
      this.#ws = null;
    }
    this.#authenticated = false;
  }

  setDesired(desired) {
    for (const channel of ['trades', 'quotes', 'bars']) {
      this.#desired[channel] = new Set(desired[channel] ?? []);
    }
    this.#syncSubscriptions();
  }

  #connect() {
    if (this.#stopped) return;
    this.#authenticated = false;
    this.#active = { trades: new Set(), quotes: new Set(), bars: new Set() };
    this.#onStatus?.({ state: 'connecting' });

    const ws = new WebSocket(this.#config.upstreamUrl, {
      headers: {
        'APCA-API-KEY-ID': this.#config.apiKeyId,
        'APCA-API-SECRET-KEY': this.#config.apiSecretKey,
      },
      handshakeTimeout: 10_000,
      perMessageDeflate: false,
    });
    this.#ws = ws;

    ws.on('open', () => {
      this.#logger.info('Alpaca WebSocket connected', { url: this.#config.upstreamUrl });
      this.#reconnectAttempt = 0;
      this.#startHeartbeat(ws);
      this.#onStatus?.({ state: 'connected' });
    });

    ws.on('pong', () => {
      this.#awaitingPong = false;
    });

    ws.on('message', (raw) => this.#handleMessage(raw));

    ws.on('error', (error) => {
      this.#logger.error('Alpaca WebSocket error', { error });
      this.#onStatus?.({ state: 'error', message: error.message });
    });

    ws.on('close', (code, reason) => {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
      this.#ws = null;
      this.#authenticated = false;
      this.#active = { trades: new Set(), quotes: new Set(), bars: new Set() };
      const text = reason?.toString() || '';
      this.#logger.warn('Alpaca WebSocket closed', { code, reason: text });
      this.#onStatus?.({ state: 'disconnected', code, reason: text });
      this.#scheduleReconnect();
    });
  }

  #startHeartbeat(ws) {
    clearInterval(this.#heartbeatTimer);
    this.#awaitingPong = false;
    this.#heartbeatTimer = setInterval(() => {
      if (ws !== this.#ws || ws.readyState !== WebSocket.OPEN) return;
      if (this.#awaitingPong) {
        this.#logger.warn('Alpaca WebSocket heartbeat timed out');
        ws.terminate();
        return;
      }
      this.#awaitingPong = true;
      try { ws.ping(); } catch { ws.terminate(); }
    }, 30_000);
    this.#heartbeatTimer.unref?.();
  }

  #handleMessage(raw) {
    let messages;
    try {
      messages = JSON.parse(raw.toString());
    } catch (error) {
      this.#logger.warn('Ignored malformed Alpaca message', { error });
      return;
    }
    if (!Array.isArray(messages)) messages = [messages];

    for (const message of messages) {
      if (!message || typeof message !== 'object') continue;
      if (message.T === 'success') {
        if (message.msg === 'authenticated') {
          this.#authenticated = true;
          this.#onStatus?.({ state: 'authenticated' });
          this.#syncSubscriptions();
        }
        continue;
      }
      if (message.T === 'subscription') {
        for (const channel of ['trades', 'quotes', 'bars']) {
          this.#active[channel] = new Set(message[channel] ?? []);
        }
        this.#onStatus?.({ state: 'subscription', active: this.status.active });
        continue;
      }
      if (message.T === 'error') {
        this.#logger.error('Alpaca protocol error', { code: message.code, message: message.msg });
        this.#onStatus?.({ state: 'upstream_error', code: message.code, message: message.msg });
        continue;
      }
      if (['t', 'q', 'b', 'u'].includes(message.T)) this.#onMarketMessage?.(message);
    }
  }

  #syncSubscriptions() {
    const ws = this.#ws;
    if (!this.#authenticated || !ws || ws.readyState !== WebSocket.OPEN) return;

    const subscribe = { action: 'subscribe' };
    const unsubscribe = { action: 'unsubscribe' };
    let hasSubscribe = false;
    let hasUnsubscribe = false;

    for (const channel of ['trades', 'quotes', 'bars']) {
      if (sameSet(this.#desired[channel], this.#active[channel])) continue;
      const additions = diff(this.#desired[channel], this.#active[channel]);
      const removals = diff(this.#active[channel], this.#desired[channel]);
      if (additions.length) {
        subscribe[channel] = additions;
        hasSubscribe = true;
      }
      if (removals.length) {
        unsubscribe[channel] = removals;
        hasUnsubscribe = true;
      }
    }

    if (hasUnsubscribe) ws.send(JSON.stringify(unsubscribe));
    if (hasSubscribe) ws.send(JSON.stringify(subscribe));
  }

  #scheduleReconnect() {
    if (this.#stopped || this.#reconnectTimer) return;
    const base = Math.min(30_000, 1_000 * 2 ** Math.min(this.#reconnectAttempt, 5));
    this.#reconnectAttempt += 1;
    const delay = jitter(base);
    this.#logger.info('Scheduling Alpaca reconnect', { delayMs: delay });
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, delay);
    this.#reconnectTimer.unref?.();
  }
}
