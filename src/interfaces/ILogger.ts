export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

export interface ILogger {
   
  debug(msg: string, ...args: any[]): void;
   
  info(msg: string, ...args: any[]): void;
   
  warn(msg: string, ...args: any[]): void;
   
  error(msg: string, ...args: any[]): void;
  child(context: Record<string, unknown>): ILogger;
  getLevel(): number;
}
