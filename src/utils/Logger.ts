import { ILogger, LogLevel } from '../interfaces/ILogger.js';
import { ContextStack } from '../core/ContextStack.js';

export type LogHandler = (level: LogLevel, formattedMsg: string, originalMsg: string, ...args: any[]) => void;

/**
 * `text`: `[time] [context] message`, as it always was. `json`: one object per line -- time, level,
 * message, the logger's context (node, part, contract, organization) and the trace and span the
 * line was written in -- what a log store can search, and what ties a line to a request.
 */
export type LogFormat = 'text' | 'json';

const LEVEL_NAMES: Record<number, string> = {
    [LogLevel.DEBUG]: 'debug',
    [LogLevel.INFO]: 'info',
    [LogLevel.WARN]: 'warn',
    [LogLevel.ERROR]: 'error',
};

/** An argument as JSON can hold it: an Error by its message and stack, anything else as itself. */
function plain(value: unknown): unknown {
    if (value instanceof Error) {
        return { error: value.message, ...(value.stack !== undefined ? { stack: value.stack } : {}) };
    }

    return value;
}

/** A line never fails to be written: a value JSON cannot hold (a cycle, a BigInt) is said so instead. */
function stringify(record: Record<string, unknown>): string {
    try {
        return JSON.stringify(record);
    } catch (err) {
        return JSON.stringify({ time: record['time'], level: record['level'], msg: record['msg'], unprintable: err instanceof Error ? err.message : String(err) });
    }
}

export class Logger implements ILogger {
    private level: LogLevel = LogLevel.INFO;
    private context: Record<string, unknown> = {};
    private handler?: LogHandler;
    private readonly lineFormat: LogFormat;

    constructor(level: LogLevel = LogLevel.INFO, context: Record<string, unknown> = {}, handler?: LogHandler, format: LogFormat = 'text') {
        this.level = level;
        this.context = context;
        this.handler = handler;
        this.lineFormat = format;
    }

    private format(level: LogLevel, msg: string, args: readonly unknown[]): string {
        if (this.lineFormat === 'json') {
            const active = ContextStack.getContext();

            return stringify({
                time: new Date().toISOString(),
                level: LEVEL_NAMES[level] ?? String(level),
                msg,
                ...this.context,
                ...(active?.traceId !== undefined ? { traceId: active.traceId } : {}),
                ...(active?.spanId !== undefined ? { spanId: active.spanId } : {}),
                ...(args.length > 0 ? { args: args.map(plain) } : {}),
            });
        }

        const ctxStr = Object.keys(this.context).length ? ` [${JSON.stringify(this.context)}]` : '';
        return `[${new Date().toISOString()}]${ctxStr} ${msg}`;
    }

    private emit(level: LogLevel, consoleMethod: (...args: any[]) => void, msg: string, args: any[]) {
        if (this.level <= level) {
            const formattedMsg = this.format(level, msg, args);
            if (this.handler) {
                this.handler(level, formattedMsg, msg, ...args);
            } else if (this.lineFormat === 'json') {
                // The arguments are in the line already: one line, one record.
                consoleMethod(formattedMsg);
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
        return new Logger(this.level, { ...this.context, ...context }, this.handler, this.lineFormat);
    }

    getLevel(): number {
        return this.level;
    }

    setLevel(level: LogLevel): void {
        this.level = level;
    }
}
