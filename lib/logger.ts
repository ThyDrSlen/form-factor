type LogWriter = (...args: unknown[]) => void;

type Logger = {
  log: LogWriter;
  info: LogWriter;
  warn: LogWriter;
  error: LogWriter;
};

const withTimestamp = (writer: LogWriter): LogWriter => {
  return (...args: unknown[]) => {
    writer(new Date().toISOString(), ...args);
  };
};

export const logWithTs = withTimestamp(console.log);
export const infoWithTs = withTimestamp(console.info);
export const warnWithTs = withTimestamp(console.warn);
export const errorWithTs = withTimestamp(console.error);

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
