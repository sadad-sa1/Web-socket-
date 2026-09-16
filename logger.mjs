const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

function serialize(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: value.cause,
    };
  }
  return value;
}

export function createLogger(levelName = 'info') {
  const threshold = LEVELS[levelName] ?? LEVELS.info;

  function write(level, message, meta = {}) {
    if (LEVELS[level] < threshold) return;
    const payload = {
      ts: new Date().toISOString(),
      level,
      message,
      ...Object.fromEntries(
        Object.entries(meta).map(([key, value]) => [key, serialize(value)]),
      ),
    };
    const line = JSON.stringify(payload);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  };
}
