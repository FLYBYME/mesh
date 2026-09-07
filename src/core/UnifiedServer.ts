import { Env } from '../utils/Env.js';

export interface IHttpServer {
    listen(port: number, cb: () => void): void;
    listen(port: number, host: string, cb: () => void): void;
    close(cb: () => void): void;
    address(): unknown;
    on(event: string, cb: (data: unknown) => void): void;
}

export class UnifiedServer {
    private app: unknown = null;
    private server: IHttpServer | null = null;
    private port: number;
    private host: string;
    private listening = false;

    constructor(port = 0, host = '127.0.0.1') {
        this.port = port;
        this.host = host;
    }

    private async init(): Promise<void> {
        if (this.server || !Env.isNode()) return;
        
        try {
            const express = await import('express');
            const http = await import('node:http');
             
            const appFactory = (express.default || express) as any;
            this.app = appFactory();
             
            this.server = http.createServer(this.app as any) as unknown as IHttpServer;
        } catch {
            // Fallback or ignore
        }
    }

    getApp(): unknown { return this.app; }
    getServer(): IHttpServer | null { return this.server; }
    getPort(): number { return this.port; }
    getHost(): string { return this.host; }

    async listen(): Promise<number | null> {
        if (!Env.isNode() || this.listening) return this.port;

        await this.init();
        if (!this.server) return null;

        return new Promise((resolve, reject) => {
            this.server!.listen(this.port, this.host, () => {
                const addr = this.server!.address();
                if (addr && typeof addr === 'object') this.port = (addr as { port: number }).port;
                this.listening = true;
                resolve(this.port);
            });
            this.server!.on('error', reject);
        });
    }

    async stop(): Promise<void> {
        if (!this.listening || !this.server) return;
        return new Promise((resolve) => {
            this.server!.close(() => {
                this.listening = false;
                resolve();
            });
        });
    }
}
