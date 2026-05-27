export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

export interface ILogger {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug(msg: string, ...args: any[]): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info(msg: string, ...args: any[]): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn(msg: string, ...args: any[]): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error(msg: string, ...args: any[]): void;
  child(context: Record<string, unknown>): ILogger;
  getLevel(): number;
}
