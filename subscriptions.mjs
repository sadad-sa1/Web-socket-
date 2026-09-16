import { CHANNELS } from './protocol.mjs';

function createChannelMap() {
  return Object.fromEntries(CHANNELS.map((channel) => [channel, new Map()]));
}

export class SubscriptionManager {
  #clients = new Map();
  #refs = createChannelMap();
  #base = createChannelMap();

  constructor(baseSymbols = []) {
    for (const channel of CHANNELS) {
      for (const symbol of baseSymbols) this.#base[channel].set(symbol, 1);
    }
  }

  addClient(id) {
    if (!this.#clients.has(id)) {
      this.#clients.set(id, Object.fromEntries(CHANNELS.map((channel) => [channel, new Set()])));
    }
  }

  removeClient(id) {
    const client = this.#clients.get(id);
    if (!client) return;
    for (const channel of CHANNELS) {
      for (const symbol of client[channel]) this.#decrement(channel, symbol);
    }
    this.#clients.delete(id);
  }

  subscribe(id, symbols, channels) {
    this.addClient(id);
    const client = this.#clients.get(id);
    for (const channel of channels) {
      for (const symbol of symbols) {
        if (client[channel].has(symbol)) continue;
        client[channel].add(symbol);
        this.#increment(channel, symbol);
      }
    }
  }

  unsubscribe(id, symbols, channels) {
    const client = this.#clients.get(id);
    if (!client) return;
    for (const channel of channels) {
      for (const symbol of symbols) {
        if (!client[channel].delete(symbol)) continue;
        this.#decrement(channel, symbol);
      }
    }
  }

  clientView(id) {
    const client = this.#clients.get(id);
    if (!client) return Object.fromEntries(CHANNELS.map((channel) => [channel, []]));
    return Object.fromEntries(CHANNELS.map((channel) => [channel, [...client[channel]].sort()]));
  }

  desired() {
    return Object.fromEntries(
      CHANNELS.map((channel) => [
        channel,
        [...new Set([...this.#base[channel].keys(), ...this.#refs[channel].keys()])].sort(),
      ]),
    );
  }

  uniqueSymbols() {
    const symbols = new Set();
    for (const channel of CHANNELS) {
      for (const symbol of this.#base[channel].keys()) symbols.add(symbol);
      for (const symbol of this.#refs[channel].keys()) symbols.add(symbol);
    }
    return symbols;
  }

  #increment(channel, symbol) {
    const current = this.#refs[channel].get(symbol) ?? 0;
    this.#refs[channel].set(symbol, current + 1);
  }

  #decrement(channel, symbol) {
    const current = this.#refs[channel].get(symbol) ?? 0;
    if (current <= 1) this.#refs[channel].delete(symbol);
    else this.#refs[channel].set(symbol, current - 1);
  }
}
