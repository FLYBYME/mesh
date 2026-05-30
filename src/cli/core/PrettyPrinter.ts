import { C } from './Utils.js';
import { Logger } from '../../utils/Logger.js';
import { LogLevel } from '../../interfaces/ILogger.js';

interface Message {
    role: string;
    content?: string;
    thinking?: string;
    toolCalls?: Array<{
        name: string;
        arguments: Record<string, unknown>;
    }>;
    createdAt?: string | number | Date;
}

export class PrettyPrinter {
    private static logger = new Logger(LogLevel.INFO, {}, (level, _fm, originalMsg, ...args) => {
        if (level === LogLevel.ERROR) console.error(originalMsg, ...args);
        else if (level === LogLevel.WARN) console.warn(originalMsg, ...args);
        else console.log(originalMsg, ...args);
    });

    public static printResponse(data: unknown): void {
        if (!data) return;

        // 1. Detect if this is a message list or contains one
        if (Array.isArray(data) && data.length > 0 && this.isMessage(data[0])) {
            this.printMessages(data as Message[]);
            return;
        }

        if (typeof data === 'object' && data !== null) {
            const obj = data as Record<string, unknown>;
            const keys = Object.keys(obj);
            const messageKey = keys.find(k => Array.isArray(obj[k]) && (obj[k] as unknown[]).length > 0 && this.isMessage((obj[k] as unknown[])[0]));

            if (messageKey) {
                // Print metadata first
                const meta = { ...obj };
                delete meta[messageKey];
                if (Object.keys(meta).length > 0) {
                    this.logger.info('', meta);
                    this.logger.info('\x1b[2m' + '─'.repeat(50) + '\x1b[0m');
                }
                this.printMessages(obj[messageKey] as Message[]);
                return;
            }
        }

        // Default fallback
        this.logger.info('', data);
    }

    private static isMessage(obj: unknown): obj is Message {
        return !!obj && typeof obj === 'object' && 'role' in obj && ('content' in obj || 'toolCalls' in obj);
    }

    private static printMessages(messages: Message[]): void {
        for (const msg of messages) {
            const roleColor = this.getRoleColor(msg.role);
            const roleName = msg.role.toUpperCase().padEnd(10);
            const timestamp = msg.createdAt ? `\x1b[2m(${new Date(msg.createdAt).toLocaleString()})\x1b[0m` : '';

            this.logger.info(`${roleColor}${C.bold}[${roleName}]${C.reset} ${timestamp}`);

            if (msg.content) {
                this.logger.info(msg.content.trim());
            }

            if (msg.toolCalls && msg.toolCalls.length > 0) {
                for (const tc of msg.toolCalls) {
                    this.logger.info(`${C.yellow}🛠  ${tc.name}${C.reset}(${JSON.stringify(tc.arguments)})`);
                }
            }
            
            this.logger.info(''); // Newline between messages
        }
    }

    private static getRoleColor(role: string): string {
        switch (role) {
            case 'user': return C.cyan;
            case 'assistant': return C.green;
            case 'tool': return C.magenta;
            case 'thought': return C.dim + C.italic;
            case 'system': return C.red;
            default: return C.white;
        }
    }
}
