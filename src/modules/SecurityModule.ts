import { IMeshModule, IMeshApp, ILogger } from '../interfaces/index.js';

export interface SecurityConfig {
    privateKey?: string;
    publicKey?: string;
}

/**
 * SecurityModule — manages the node's cryptographic identity and keys.
 */
export class SecurityModule implements IMeshModule {
    public readonly name = 'security';
    public logger?: ILogger;
    
    constructor(private config: SecurityConfig = {}) {}

    onInit(app: IMeshApp): void {
        this.logger = app.logger;
        
        // Register security configuration as a provider
        app.registerProvider('security:config', this.config);
        
        this.logger.info(`[SecurityModule] Initialized with ${this.config.publicKey ? 'provided' : 'no'} public key.`);
    }

    async onStart(): Promise<void> {
        this.logger?.debug(`[SecurityModule] Security module started.`);
    }
}
