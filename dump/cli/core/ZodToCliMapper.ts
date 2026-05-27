import { z } from 'zod';
import { Command } from 'commander';

/**
 * ZodToCliMapper: Recursively maps Zod schemas to Commander.js options.
 * Handles nested objects, records, and utilizes .describe() for help text.
 */
export class ZodToCliMapper {
    /**
     * Maps a Zod schema to a Commander.js command's options.
     */
    public static applyOptions(program: Command, schema: z.ZodTypeAny, prefix: string = ''): void {
        const unwrapped = this.unwrapSchema(schema);

        if (unwrapped instanceof z.ZodObject) {
            const shape = unwrapped.shape as Record<string, z.ZodTypeAny>;
            for (const [key, value] of Object.entries(shape)) {
                const fullKey = prefix ? `${prefix}.${key}` : key;
                this.mapFieldToOption(program, value, fullKey);
            }
        }
    }

    /**
     * Unflattens dot-notation options and handles type coercion.
     */
    public static parseOptions<T extends z.ZodTypeAny>(
        rawOptions: Record<string, unknown>, 
        schema: T
    ): z.infer<T> {
        const result: Record<string, unknown> = {};
        const unwrapped = this.unwrapSchema(schema);

        for (const [key, value] of Object.entries(rawOptions)) {
            const parts = key.split('.');
            let current = result;
            let currentSchema: z.ZodTypeAny = unwrapped;

            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i]!;
                if (!current[part] || typeof current[part] !== 'object') {
                    current[part] = {};
                }
                current = current[part] as Record<string, unknown>;
                
                if (currentSchema instanceof z.ZodObject) {
                    const nextSchema = currentSchema.shape[part] as z.ZodTypeAny | undefined;
                    if (nextSchema) currentSchema = this.unwrapSchema(nextSchema);
                }
            }

            const lastPart = parts[parts.length - 1]!;
            let fieldSchema: z.ZodTypeAny | undefined;
            if (currentSchema instanceof z.ZodObject) {
                const field = currentSchema.shape[lastPart] as z.ZodTypeAny | undefined;
                if (field) fieldSchema = this.unwrapSchema(field);
            }

            current[lastPart] = this.coerceValue(value, fieldSchema);
        }

        return result as z.infer<T>;
    }

    private static coerceValue(value: unknown, schema?: z.ZodTypeAny): unknown {
        if (typeof value !== 'string') return value;

        const trimmed = value.trim();

        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try { return JSON.parse(trimmed); } catch { /* ignore */ }
        }

        if (schema instanceof z.ZodNumber) {
            const n = parseFloat(trimmed);
            return isNaN(n) ? value : n;
        }
        if (schema instanceof z.ZodBoolean) {
            if (trimmed.toLowerCase() === 'true') return true;
            if (trimmed.toLowerCase() === 'false') return false;
        }

        return value;
    }

    private static mapFieldToOption(program: Command, schema: z.ZodTypeAny, key: string): void {
        const description = this.extractDescription(schema);
        const unwrapped = this.unwrapSchema(schema);

        if (unwrapped instanceof z.ZodObject) {
            this.applyOptions(program, unwrapped, key);
            return;
        }

        if (unwrapped instanceof z.ZodArray) {
            program.option(`--${key} <values...>`, description);
            return;
        }

        if (unwrapped instanceof z.ZodEnum) {
            const values = (unwrapped._def as { values: string[] }).values.join('|');
            program.option(`--${key} <${values}>`, description);
            return;
        }

        if (unwrapped instanceof z.ZodBoolean) {
            program.option(`--${key}`, description);
            program.option(`--no-${key}`, `Disable ${key}`);
            return;
        }

        if (unwrapped instanceof z.ZodNumber) {
            program.option(`--${key} <number>`, description);
            return;
        }

        if (unwrapped instanceof z.ZodRecord) {
            program.allowUnknownOption(true);
            program.option(`--${key} <json>`, `${description} (Supports dot-notation: --${key}.field value)`);
            return;
        }

        program.option(`--${key} <string>`, description);
    }

    private static extractDescription(schema: z.ZodTypeAny): string {
        let current = schema;
        if (current.description) return current.description;
        
        while (
            current instanceof z.ZodOptional ||
            current instanceof z.ZodNullable ||
            current instanceof z.ZodDefault
        ) {
            if (current instanceof z.ZodOptional) current = current.unwrap();
            else if (current instanceof z.ZodNullable) current = current.unwrap();
            else if (current instanceof z.ZodDefault) current = current._def.innerType as z.ZodTypeAny;
            if (current.description) return current.description;
        }
        return current.description || '';
    }

    private static unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
        let current = schema;
        while (
            current instanceof z.ZodOptional ||
            current instanceof z.ZodNullable ||
            current instanceof z.ZodDefault
        ) {
            if (current instanceof z.ZodOptional) current = current.unwrap();
            else if (current instanceof z.ZodNullable) current = current.unwrap();
            else if (current instanceof z.ZodDefault) current = current._def.innerType as z.ZodTypeAny;
        }
        return current;
    }
}
