import type { IContext, ILogger, ServiceState  } from '../interfaces';

export type { 
    IContext as Context,
    ILogger,
    ServiceState
};

export interface IMeshAuthMeta extends Record<string, unknown> {
    shardKey?: string;
}

export interface RegistryConfig {
    dht?: {
        enabled: boolean;
        bucketSize?: number;
    };
    heartbeatInterval?: number;
}
