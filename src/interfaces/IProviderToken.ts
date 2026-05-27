export type IProviderToken<T> = (string | symbol | (new (...args: unknown[]) => T)) & { __brand?: T };
