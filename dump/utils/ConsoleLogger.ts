import type { ILogger } from '../interfaces/ILogger';
import { LogLevel } from '../interfaces/ILogger';

/**
 * Standardized Logger Implementation.
 */
export class ConsoleLogger implements ILogger {
    constructor(
        private context: Record<string, unknown> = {},
        private level: LogLevel = LogLevel.ERROR
    ) { }

    private shouldLog(level: LogLevel): boolean {
        return level >= this.level;
    }

    private format(msg: string) {
        const timestamp = new Date().toISOString();
        const ctx = Object.keys(this.context).length ? ` [${JSON.stringify(this.context)}]` : '';
        return `[${timestamp}]${ctx} ${msg}`;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    debug(msg: string, ...args: any[]): void {
        if ((globalThis as unknown as Record<string, unknown>).MESH_SILENT) return;
        if (this.shouldLog(LogLevel.DEBUG)) console.debug(this.format(msg), ...args);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    info(msg: string, ...args: any[]): void {
        if ((globalThis as unknown as Record<string, unknown>).MESH_SILENT) return;
        if (this.shouldLog(LogLevel.INFO)) console.info(this.format(msg), ...args);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    warn(msg: string, ...args: any[]): void {
        if ((globalThis as unknown as Record<string, unknown>).MESH_SILENT) return;
        if (this.shouldLog(LogLevel.WARN)) console.warn(this.format(msg), ...args);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    error(msg: string, ...args: any[]): void {
        if ((globalThis as unknown as Record<string, unknown>).MESH_SILENT) return;
        if (this.shouldLog(LogLevel.ERROR)) console.error(this.format(msg), ...args);
    }

    getLevel(): LogLevel {
        return this.level;
    }

    child(context: Record<string, unknown>): ILogger {
        return new ConsoleLogger({ ...this.context, ...context }, this.level);
    }
}
