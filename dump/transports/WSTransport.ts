// Dynamic exports to prevent Node.js modules from leaking into browser builds.
// The bundler (Vite/Webpack) will still see these, but conditional conditions in package.json
// or manual shimming usually handles this. 
// For pure source-first, we use index.browser.ts as the primary defense.

import { BrowserWebSocketTransport } from './browser/BrowserWebSocketTransport';

/**
 * WSTransport proxy.
 * In a Source-First environment, we rely on index.browser.ts to redirect this to the correct implementation.
 * This file remains as a fallback/isomorphic entry.
 */
export const WSTransport = (typeof window !== 'undefined' || typeof self !== 'undefined')
    ? BrowserWebSocketTransport
    : null as any; // Node side should import from ./node/WSTransport directly or via index.ts

export type WSTransportInstance = InstanceType<typeof BrowserWebSocketTransport>;
