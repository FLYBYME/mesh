import type {
    IServiceBroker,
    IMeshApp,
    ILogger,
    IMeshNetwork,
    IServiceRegistry,
    IContext,
    IMeshPacket,
    IServiceActionRegistry,
    IServiceEventRegistry,
    IBrokerPlugin,
    IMiddleware,
    IMeshMeta,
    TimerHandle
} from '../interfaces';
import { SafeTimer } from '../interfaces';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { EventEmitter } from 'eventemitter3';
import { ContextStack } from './ContextStack';
import type { IServiceModule } from '../services/ServiceModule';

/**
 * Metadata for local actions.
 */
interface LocalAction {
    handler: (ctx: IContext<Record<string, unknown>, Record<string, unknown>>) => Promise<unknown>;
    highSecurity?: boolean;
}

/**
 * Runtime Action Registry for Zod validation.
 */
export const MeshActionSchemaRegistry: Map<string, {
    params?: z.ZodTypeAny,
    returns?: z.ZodTypeAny,
    mutates?: boolean,
    timeout?: number
}> = new Map();

/**
 * ServiceBroker — The "OS Kernel" that routes requests locally or remotely.
 */
export class ServiceBroker implements IServiceBroker {
    private localServices = new Map<string, LocalAction>();
    private modules: IServiceModule[] = [];
    private isStarted: boolean = false;

    // Bipartite Pipeline
    private globalMiddleware: IMiddleware[] = [];
    private localMiddleware: IMiddleware[] = [];

    private plugins: IBrokerPlugin[] = [];
    private localEvents: EventEmitter = new EventEmitter();
    private pendingListeners: { topic: string, handler: (payload: any, packet?: IMeshPacket<any>) => void }[] = [];

    public logger: ILogger;
    public registry!: IServiceRegistry;
    public network!: IMeshNetwork;
    public resiliency = {} as Record<string, unknown>;

    // RPC Correlation
    private pendingRequests = new Map<string, {
        resolve: (val: unknown) => void,
        reject: (err: Error) => void,
        timeout: TimerHandle
    }>();

    constructor(public readonly app: IMeshApp) {
        this.logger = app.getProvider<ILogger>('logger') || app.logger;
    }

    public pipe(plugin: IBrokerPlugin): this {
        this.plugins.push(plugin);
        plugin.onRegister(this);
        return this;
    }

    public setNetwork(network: IMeshNetwork): void {
        this.network = network;
        this.setupNetworkListeners();
    }

    public setRegistry(registry: IServiceRegistry): void {
        this.registry = registry;
    }

    private setupNetworkListeners() {
        if (!this.network) return;

        // Use standard network bridge
        this.network.onMessage('*', (data: unknown, packet: IMeshPacket) => {
            if (packet.type === 'RESPONSE' || packet.type === 'RESPONSE_ERROR') {
                const correlationId = (packet.meta?.correlationID || packet.id) as string;
                const pending = this.pendingRequests.get(correlationId);
                if (pending) {
                    SafeTimer.clearTimeout(pending.timeout);
                    this.pendingRequests.delete(correlationId);
                    try {
                        if (packet.type === 'RESPONSE_ERROR') {
                            const errorData = packet.error;
                            pending.reject(new Error(errorData?.message || 'Remote RPC Error'));
                        } else {
                            pending.resolve(packet.data);
                        }
                    } catch (err) {
                        this.logger.error(`[ServiceBroker] Bridge RPC error: ${err}`);
                    }
                }
            } else if (packet.type === 'REQUEST') {
                this.handleIncomingRPC(packet).then(res => {
                    this.network.send(packet.senderNodeID, packet.topic, res, {
                        type: 'RESPONSE',
                        id: packet.id,
                        meta: { correlationID: packet.id }
                    }).catch(err => this.logger.error(`[ServiceBroker] Failed to send RESPONSE: ${err}`));
                }).catch(err => {
                    this.network.send(packet.senderNodeID, packet.topic, { message: err.message }, {
                        type: 'RESPONSE_ERROR',
                        id: packet.id,
                        meta: { correlationID: packet.id },
                        error: { message: err.message }
                    }).catch(sendErr => this.logger.error(`[ServiceBroker] Failed to send RESPONSE_ERROR: ${sendErr}`));
                });
            } else if (packet.type === 'EVENT') {
                this._triggerLocal(packet.topic, packet.data, packet);
            }
        });
    }

    public use(mw: IMiddleware): void {
        this.globalMiddleware.push(mw);
    }

    public useLocal(mw: IMiddleware): void {
        this.localMiddleware.push(mw);
    }

    public getContext(): IContext<Record<string, unknown>, Record<string, unknown>> | undefined {
        return ContextStack.getContext() as IContext<Record<string, unknown>, Record<string, unknown>> | undefined;
    }

    public on<T = unknown>(topic: string, handler: (payload: T, packet?: IMeshPacket<T>) => void): (() => void) {
        if (topic.includes('*')) {
            const regex = new RegExp('^' + topic
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/\\\*/g, '.*')
                + '$');
            const wrapper = (payload: T, packet?: IMeshPacket<T>) => {
                const topicToTest = packet?.topic || topic;
                if (regex.test(topicToTest)) {
                    handler(payload, packet);
                }
            };
            (handler as any)._wrapper = wrapper;
            this.localEvents.on('__pattern_event', wrapper);
        } else {
            this.localEvents.on(topic, handler);
        }

        return () => this.off(topic, handler);
    }

    public off<T = unknown>(topic: string, handler: (payload: T, packet?: IMeshPacket<T>) => void): void {
        if (topic.includes('*')) {
            const wrapper = (handler as any)._wrapper;
            if (wrapper) this.localEvents.off('__pattern_event', wrapper);
        } else {
            this.localEvents.off(topic, handler);
        }
    }

    /**
     * Internal: Triggers local listeners from network events.
     */
    public _triggerLocal(topic: string, data: unknown, packet: IMeshPacket): void {
        this.localEvents.emit(topic, data, packet);
        this.localEvents.emit('__pattern_event', data, packet);
    }

    public async registerModule(module: IServiceModule): Promise<void> {
        const domain = module.domain;
        if (!domain) throw new Error('[ServiceBroker] Module domain must be provided');

        this.logger.info(`[ServiceBroker] Registering module: ${domain} (Node: ${this.app.nodeID})`);
        this.modules.push(module);

        if ('onInit' in module && typeof module.onInit === 'function') {
            await module.onInit(this.app);
        }

        const contracts = module.getContracts();
        this.logger.debug(`[ServiceBroker] Module '${domain}' has ${contracts.length} contracts`);

        for (const contract of contracts) {
            const actionName = `${contract.domain}:${contract.action}`;

            MeshActionSchemaRegistry.set(actionName, {
                params: contract.inputSchema,
                returns: contract.outputSchema,
                mutates: contract.destructive,
            });

            this.localServices.set(actionName, {
                handler: async (ctx: IContext<Record<string, unknown>, Record<string, unknown>>) => {
                    const serviceCtx: any = {
                        api: (this.app as any).api, // Provide mock or actual API if available
                        events: (this.app as any).events, // Provide mock or actual EventBus if available
                        services: (this.app as any).services, // Provide mock or actual ServiceRegistry if available
                        correlationId: ctx.correlationID || nanoid(),
                    };
                    return await module.execute(contract.domain, contract.action, ctx.params, serviceCtx);
                },
                highSecurity: contract.destructive === true
            });
            this.logger.info(`[ServiceBroker] Action registered successfully: ${actionName}`);
        }

        if (this.registry) {
            this.registry.registerModule(module);
        }

        if (this.isStarted && typeof module.onStart === 'function') {
            await module.onStart(this.app);
        }
    }

    public async call<K extends keyof IServiceActionRegistry>(
        action: K,
        params: IServiceActionRegistry[K] extends { params: import('zod').ZodType<infer P> } ? P : Record<string, unknown>,
        options?: { nodeID?: string; timeout?: number }
    ): Promise<IServiceActionRegistry[K] extends { returns: import('zod').ZodType<infer R> } ? R : unknown>;

    public async call<TResult = unknown>(
        action: string,
        params: unknown,
        options?: { nodeID?: string; timeout?: number }
    ): Promise<TResult>;

    public async call(action: string, params: unknown, options?: unknown): Promise<unknown> {
        return this.internalCall(action, params as Record<string, unknown>, options as { nodeID?: string; timeout?: number });
    }

    public emit(event: string, payload: unknown, options?: { skipNetwork?: boolean }): void {
        const packet: IMeshPacket = {
            id: nanoid(),
            topic: event as string,
            data: payload,
            senderNodeID: this.app.nodeID,
            type: 'EVENT',
            timestamp: Date.now(),
            version: 1,
            priority: 1,
            meta: { local: true }
        };

        // Always dispatch locally once immediately
        this._triggerLocal(event as string, payload, packet);

        if (this.network && !options?.skipNetwork) {
            this.network.publish(event as string, payload);
        }
    }

    private async internalCall(actionName: string, params: Record<string, unknown>, options?: { nodeID?: string; timeout?: number }, parentCtx?: IContext<Record<string, unknown>, Record<string, unknown>>): Promise<unknown> {
        const schema = MeshActionSchemaRegistry.get(actionName);
        if (schema?.params && params !== undefined) {
            try {
                if (typeof schema.params.parse === 'function') {
                    params = schema.params.parse(params);
                }
            } catch (error) {
                throw new Error(`[ServiceBroker] Invalid params for action ${actionName}: ${error}`);
            }
        } else if (params === undefined) {
            params = {};
        }

        let targetNodeID = options?.nodeID;

        if (!targetNodeID && !this.localServices.has(actionName)) {
            if (this.registry) {
                const endpoint = this.registry.selectNode(actionName, {
                    action: actionName,
                    params
                });
                if (endpoint) {
                    targetNodeID = endpoint.nodeID;
                }
            }
        }

        const activeCtx = parentCtx || this.getContext();
        const traceId = activeCtx?.traceId || nanoid();
        const parentId = activeCtx?.spanId;
        const spanId = nanoid();

        const timeout = options?.timeout || schema?.timeout;

        const ctx: IContext<Record<string, unknown>, IMeshMeta> = {
            id: nanoid(),
            correlationID: activeCtx?.correlationID || nanoid(),
            actionName,
            params: params as Record<string, unknown>,
            meta: { ...activeCtx?.meta as IMeshMeta, timeout },
            targetNodeID: targetNodeID,
            callerID: activeCtx?.id || null,
            nodeID: this.app.nodeID,
            traceId,
            spanId,
            parentId,
            call: (a: string, p: Record<string, unknown>, o?: any) => (this as any).call(a, p, { ...o, parentContext: ctx }),
            emit: (e: string, p: Record<string, unknown>) => this.emit(e as keyof IServiceEventRegistry, p)
        };

        const result = await this.handlePipeline(ctx);
        if (schema?.returns) {
            return schema.returns.parse(result);
        }
        return result;
    }

    public async handleIncomingRPC(packet: IMeshPacket): Promise<unknown> {
        const meta = (packet.meta as Record<string, unknown>) || {};
        const targetNodeID = (meta.finalDestinationID as string) || packet.targetNodeID;

        const ctx: IContext<Record<string, unknown>, IMeshMeta> = {
            id: packet.id,
            correlationID: (packet.meta?.correlationID as string) || packet.id,
            actionName: packet.topic,
            params: packet.data as Record<string, unknown>,
            meta: meta as IMeshMeta,
            callerID: packet.senderNodeID,
            nodeID: this.app.nodeID,
            targetNodeID: targetNodeID,
            traceId: (meta.traceId as string) || nanoid(),
            spanId: (meta.spanId as string) || nanoid(),
            parentId: meta.parentId as string,
            call: (a: string, p: Record<string, unknown>, o?: any) => (this as any).call(a, p, { ...o, parentContext: ctx }),
            emit: (e: string, p: Record<string, unknown>) => this.emit(e as keyof IServiceEventRegistry, p)
        };

        const result = await this.handlePipeline(ctx);
        const schema = MeshActionSchemaRegistry.get(packet.topic);
        if (schema?.returns) {
            return schema.returns.parse(result);
        }
        return result;
    }

    public async handlePipeline(ctx: IContext<Record<string, unknown>, Record<string, unknown>>): Promise<unknown> {
        return await ContextStack.run(ctx, async () => {
            try {
                const finalHandler = async () => {
                    const isLocal = !ctx.targetNodeID || ctx.targetNodeID === this.app.nodeID;
                    if (isLocal) {
                        const action = this.localServices.get(ctx.actionName);
                        if (!action) {
                            this.logger.error(`[ServiceBroker] Local action not found: ${ctx.actionName}`, {
                                targetNodeID: ctx.targetNodeID,
                                appNodeID: this.app.nodeID,
                                registeredActions: Array.from(this.localServices.keys())
                            });
                            throw new Error(`[ServiceBroker] Local action not found: ${ctx.actionName}`);
                        }
                        return await action.handler(ctx);
                    } else {
                        return await this.executeRemote(ctx.targetNodeID!, ctx.actionName, ctx.params, ctx.meta);
                    }
                };

                const isLocalInitially = !ctx.targetNodeID || ctx.targetNodeID === this.app.nodeID;
                const chain = [...this.globalMiddleware];
                if (isLocalInitially) {
                    chain.push(...this.localMiddleware);
                }

                return await this.executeChain(ctx, chain, finalHandler);

            } catch (err) {
                ctx.error = err instanceof Error ? err : new Error(String(err));
                throw ctx.error;
            }
        });
    }

    private async executeChain(
        ctx: IContext<Record<string, unknown>, Record<string, unknown>>,
        chain: IMiddleware[],
        finalHandler: () => Promise<unknown>
    ): Promise<unknown> {
        const executeNext = async (index: number): Promise<unknown> => {
            if (index < chain.length) {
                return await chain[index](ctx, () => executeNext(index + 1));
            }
            return await finalHandler();
        };
        return await executeNext(0);
    }

    public async executeRemote(nodeID: string, actionName: string, params: unknown, meta: Record<string, unknown> = {}): Promise<unknown> {
        if (!this.network) throw new Error('[ServiceBroker] Network not initialized');

        const requestId = (meta.correlationID as string) || (meta.id as string) || nanoid();

        const currentCtx = this.getContext();
        const tracingMeta = {
            traceId: currentCtx?.traceId,
            spanId: currentCtx?.spanId,
            parentId: currentCtx?.parentId
        };

        const schema = MeshActionSchemaRegistry.get(actionName);
        const timeoutMs = (meta.timeout as number) || schema?.timeout || (this.app.config.rpcTimeout as number) || 10000;

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error(`[ServiceBroker] RPC Timeout calling ${actionName} on ${nodeID} after ${timeoutMs}ms`));
            }, timeoutMs) as unknown as TimerHandle;
            this.pendingRequests.set(requestId, { resolve, reject, timeout });
            this.network.send(nodeID, actionName, params, {
                id: requestId,
                type: 'REQUEST',
                meta: { ...meta, ...tracingMeta, correlationID: requestId },
                senderNodeID: this.app.nodeID,
                topic: actionName
            }).catch(err => {
                SafeTimer.clearTimeout(timeout);
                this.pendingRequests.delete(requestId);
                reject(err instanceof Error ? err : new Error(String(err)));
            });
        });
    }

    public async start(): Promise<void> {
        this.isStarted = true;

        for (const plugin of this.plugins) {
            if (plugin.onStart) await plugin.onStart(this);
        }

        for (const module of this.modules) {
            if (typeof module.onStart === 'function') {
                await module.onStart(this.app);
            }
        }
    }

    public async stop(): Promise<void> {
        this.isStarted = false;

        for (const module of this.modules) {
            if (typeof module.onStop === 'function') {
                await module.onStop(this.app);
            }
        }

        for (const pending of this.pendingRequests.values()) {
            SafeTimer.clearTimeout(pending.timeout);
            pending.reject(new Error('Broker stopped'));
        }
        this.pendingRequests.clear();

        for (const plugin of this.plugins) {
            if (plugin.onStop) await plugin.onStop(this);
        }
    }

    public createService(): void { throw new Error('Not implemented'); }
    public getSetting(): void { throw new Error('Not implemented'); }
    public setSetting(): void { throw new Error('Not implemented'); }
}
