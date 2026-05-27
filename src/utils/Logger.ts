import { ILogger, LogLevel } from '../interfaces/ILogger.js';

export type LogHandler = (level: LogLevel, formattedMsg: string, originalMsg: string, ...args: any[]) => void;

export class Logger implements ILogger {
    private level: LogLevel = LogLevel.INFO;
    private context: Record<string, unknown> = {};
    private handler?: LogHandler;

    constructor(level: LogLevel = LogLevel.INFO, context: Record<string, unknown> = {}, handler?: LogHandler) {
        this.level = level;
        this.context = context;
        this.handler = handler;
    }

    private format(msg: string): string {
        const ctxStr = Object.keys(this.context).length ? ` [${JSON.stringify(this.context)}]` : '';
        return `[${new Date().toISOString()}]${ctxStr} ${msg}`;
    }

    private emit(level: LogLevel, consoleMethod: (...args: any[]) => void, msg: string, args: any[]) {
        if (this.level <= level) {
            const formattedMsg = this.format(msg);
            if (this.handler) {
                this.handler(level, formattedMsg, msg, ...args);
            } else {
                consoleMethod(formattedMsg, ...args);
            }
        }
    }

    debug(msg: string, ...args: any[]): void {
        this.emit(LogLevel.DEBUG, console.debug, msg, args);
    }

    info(msg: string, ...args: any[]): void {
        this.emit(LogLevel.INFO, console.info, msg, args);
    }

    warn(msg: string, ...args: any[]): void {
        this.emit(LogLevel.WARN, console.warn, msg, args);
    }

    error(msg: string, ...args: any[]): void {
        this.emit(LogLevel.ERROR, console.error, msg, args);
    }

    child(context: Record<string, unknown>): ILogger {
        return new Logger(this.level, { ...this.context, ...context }, this.handler);
    }

    getLevel(): number {
        return this.level;
    }

    setLevel(level: LogLevel): void {
        this.level = level;
    }
}
