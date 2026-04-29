type LogWriter = (...args: unknown[]) => void;

type Logger = {
  log: LogWriter;
  info: LogWriter;
  warn: LogWriter;
  error: LogWriter;
};

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error';

// Late-bind the underlying `console.*` method on every call so that test
// doubles like `jest.spyOn(console, 'warn')` — installed after this module
// loads — are still observed. Capturing `console.warn` eagerly at module
// init would bake in the pre-spy reference and silently bypass the spy.
const withTimestamp = (method: ConsoleMethod): LogWriter => {
  return (...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console[method](new Date().toISOString(), ...args);
  };
};

export const logWithTs = withTimestamp('log');
export const infoWithTs = withTimestamp('info');
export const warnWithTs = withTimestamp('warn');
export const errorWithTs = withTimestamp('error');

export const logger: Logger = {
  log: logWithTs,
  info: infoWithTs,
  warn: warnWithTs,
  error: errorWithTs,
};

export const createLogger = (prefix: string): Logger => {
  return {
    log: (...args: unknown[]) => logWithTs(prefix, ...args),
    info: (...args: unknown[]) => infoWithTs(prefix, ...args),
    warn: (...args: unknown[]) => warnWithTs(prefix, ...args),
    error: (...args: unknown[]) => errorWithTs(prefix, ...args),
  };
};
