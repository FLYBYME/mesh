import type { IServiceBroker } from '../interfaces/IServiceBroker.js';
import type { ILogger } from '../interfaces/ILogger.js';
import type { IMeshNetwork } from '../interfaces/IMeshNetwork.js';
import type { IServiceRegistry } from '../interfaces/IServiceRegistry.js';
import type { IContext } from '../interfaces/IContext.js';
import type { IMeshPacket } from '../interfaces/IMeshNetwork.js';
import type { IBrokerPlugin } from '../interfaces/IBrokerPlugin.js';
import type { IMiddleware } from '../interfaces/IInterceptor.js';
import type { IMeshMeta } from '../interfaces/IMeshMeta.js';
import type { TimerHandle } from '../interfaces/ITimer.js';
import type { IServiceModule } from '../interfaces/IServiceModule.js';
import type { IServiceContext, ICallOptions } from '../interfaces/IServiceContext.js';
import { SafeTimer } from '../utils/SafeTimer.js';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { EventEmitter } from 'eventemitter3';
import { ContextStack } from './ContextStack.js';

interface LocalTool {
    handler: (ctx: IContext<Record<string, unknown>, Record<string, unknown>>) => Promise<unknown>;
    highSecurity?: boolean;
}

export const MeshToolSchemaRegistry: Map<string, {
    params?: z.ZodTypeAny,
    returns?: z.ZodTypeAny,
    mutates?: boolean,
    timeout?: number,
    isCrud?: boolean,
    isTimeSeries?: boolean,
    domain?: string
}> = new Map();

const MAX_RPC_TIMEOUT = 3600000; // 1 hour

export class ServiceBroker implements IServiceBroker {
    private localTools = new Map<string, LocalTool>();
    private modules: IServiceModule[] = [];
    private isStarted: boolean = false;

    private globalMiddleware: IMiddleware[] = [];
    private localMiddleware: IMiddleware[] = [];

    private plugins: IBrokerPlugin[] = [];
    private localEvents: EventEmitter = new EventEmitter();
    private patternWrappers = new WeakMap<Function, (...args: unknown[]) => void>();

    public registry!: IServiceRegistry;
    public network!: IMeshNetwork;
    public resiliency = {} as Record<string, unknown>;

    private providers = new Map<string, unknown>();

    private pendingRequests = new Map<string, {
        resolve: (val: unknown) => void,
        reject: (err: Error) => void,
        timeout: TimerHandle
    }>();

    constructor(
        public readonly nodeID: string,
        public readonly logger: ILogger
    ) { }

    private evaluateTimeout(requestedTimeout?: number, schemaTimeout?: number, remoteTimeout?: number): number {
        const timeout = requestedTimeout !== undefined ? requestedTimeout : (schemaTimeout !== undefined ? schemaTimeout : (remoteTimeout !== undefined ? remoteTimeout : 10000));
        if (timeout === 0 || timeout > MAX_RPC_TIMEOUT) {
            return MAX_RPC_TIMEOUT;
        }
        return timeout;
    }

    public registerProvider(name: string, provider: unknown): void {
        this.providers.set(name, provider);
    }

    public getProvider<T>(name: string): T {
        return this.providers.get(name) as T;
    }

    public getModule(domain: string): IServiceModule | undefined {
        return this.modules.find(m => m.domain === domain);
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

        this.network.onMessage('*', (data: unknown, packet: IMeshPacket) => {
            if (packet.type === 'RESPONSE' || packet.type === 'RESPONSE_ERROR') {
                const correlationId = (packet.meta?.correlationID || packet.id) as string;
                const pending = this.pendingRequests.get(correlationId);
                if (pending) {
                    SafeTimer.clearTimeout(pending.timeout);
                    this.pendingRequests.delete(correlationId);
                    try {
                        if (packet.type === 'RESPONSE_ERROR') {
                            const errorData = packet.error as { message?: string, data?: { stack?: string } };
                            const err = new Error(errorData?.message || 'Remote RPC Error', { cause: packet.error });
                            if (errorData?.data?.stack) {
                                err.stack = errorData.data.stack + '\n--- Remote Boundary ---\n' + err.stack;
                            }
                            pending.reject(err);
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
                    const message = err instanceof Error ? err.message : String(err);
                    this.network.send(packet.senderNodeID, packet.topic, { message }, {
                        type: 'RESPONSE_ERROR',
                        id: packet.id,
                        meta: { correlationID: packet.id },
                        error: { message, data: { stack: err instanceof Error ? err.stack : undefined } }
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

    public on<K extends keyof EventRegistry>(event: K, handler: (payload: EventRegistry[K], packet?: IMeshPacket<EventRegistry[K]>) => void): (() => void) {
        const topic = String(event);
        if (topic.includes('*')) {
            const regex = new RegExp('^' + topic
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/\\\*/g, '.*')
                + '$');
            const wrapper = (payload: any, packet?: IMeshPacket<any>) => {
                const topicToTest = packet?.topic || topic;
                if (regex.test(topicToTest)) {
                    handler(payload, packet);
                }
            };
            this.patternWrappers.set(handler as Function, wrapper as (...args: unknown[]) => void);
            this.localEvents.on('__pattern_event', wrapper);
        } else {
            this.localEvents.on(topic, handler);
        }

        return () => this.off(event, handler);
    }

    public off<K extends keyof EventRegistry>(event: K, handler: (payload: EventRegistry[K], packet?: IMeshPacket<EventRegistry[K]>) => void): void {
        const topic = String(event);
        if (topic.includes('*')) {
            const wrapper = this.patternWrappers.get(handler as Function);
            if (wrapper) this.localEvents.off('__pattern_event', wrapper);
        } else {
            this.localEvents.off(topic, handler);
        }
    }

    public _triggerLocal(topic: string, data: unknown, packet: IMeshPacket): void {
        this.localEvents.emit(topic, data, packet);
        this.localEvents.emit('__pattern_event', data, packet);
    }

    public async registerModule(module: IServiceModule): Promise<void> {
        const domain = module.domain;
        if (!domain) throw new Error('[ServiceBroker] Module domain must be provided');

        this.logger.info(`[ServiceBroker] Registering module: ${domain} (Node: ${this.nodeID})`);
        this.modules.push(module);

        if (module.onInit) {
            await module.onInit(this);
        }

        const contracts = module.getContracts();
        this.logger.debug(`[ServiceBroker] Module '${domain}' has ${contracts.length} contracts`);

        for (const contract of contracts) {
            const toolKeyStr = `${contract.domain}.${contract.action}`;

            MeshToolSchemaRegistry.set(toolKeyStr, {
                params: contract.inputSchema as z.ZodTypeAny,
                returns: contract.outputSchema as z.ZodTypeAny,
                mutates: contract.destructive,
                isCrud: contract.isCrud,
                isTimeSeries: contract.isTimeSeries,
                domain: contract.domain,
                timeout: contract.timeout
            });

            this.localTools.set(toolKeyStr, {
                handler: async (ctx: IContext<Record<string, unknown>, Record<string, unknown>>) => {
                    const serviceCtx = {
                        broker: this,
                        meta: ctx.meta,
                        correlationId: ctx.correlationID || nanoid(),
                        nodeID: this.nodeID,
                        call: async <K extends keyof IServiceToolRegistry>(
                            tool: K,
                            params: IServiceToolRegistry[K]['params'],
                            options?: { nodeID?: string; timeout?: number }
                        ): Promise<IServiceToolRegistry[K]['returns']> => {
                            const result = await this.call(tool, params, options);
                            return result as IServiceToolRegistry[K]['returns'];
                        },
                        emit: <K extends keyof EventRegistry>(
                            event: K,
                            payload: EventRegistry[K],
                            options?: { skipNetwork?: boolean }
                        ) => this.emit(event, payload, options),
                        logger: this.logger
                    };
                    return await module.execute(contract.domain, contract.action, ctx.params, serviceCtx as never);
                },
                highSecurity: contract.destructive === true
            });
            this.logger.info(`[ServiceBroker] Tool registered successfully: ${toolKeyStr}`);
        }

        if (this.registry) {
            this.registry.registerModule(module);
        }

        // Subscribe declarative event handlers
        if (typeof module.getEventHandlers === 'function') {
            const eventHandlers = module.getEventHandlers();
            for (const [name, handler] of eventHandlers.entries()) {
                this.logger.info(`[ServiceBroker] Subscribing service ${domain} to event: ${String(name)}`);
                this.localEvents.on(name as string, (data: unknown, packet?: IMeshPacket) => {
                    const ctx = {
                        broker: this,
                        correlationId: packet?.id || nanoid(),
                        nodeID: this.nodeID,
                        meta: packet?.meta,
                        call: async <K extends keyof IServiceToolRegistry>(
                            tool: K,
                            params: IServiceToolRegistry[K]['params'],
                            options?: ICallOptions<IMeshMeta>
                        ): Promise<IServiceToolRegistry[K]['returns']> => {
                            const result = await this.call(tool, params, options);
                            return result as IServiceToolRegistry[K]['returns'];
                        },
                        emit: <K extends keyof EventRegistry>(
                            event: K,
                            payload: EventRegistry[K],
                            options?: { skipNetwork?: boolean }
                        ) => this.emit(event, payload, options),
                        logger: this.logger
                    };
                    void Promise.resolve(handler(data, ctx as never)).catch((err: unknown) => {
                        this.logger.error(`[ServiceBroker] Error in event handler for ${String(name)}:`, err);
                    });
                });
            }
        }

        if (this.isStarted && module.onStart) {
            await module.onStart(this);
        }
    }

    public async call<K extends keyof IServiceToolRegistry>(
        tool: K,
        params: IServiceToolRegistry[K]['params'],
        options?: ICallOptions<IMeshMeta>
    ): Promise<IServiceToolRegistry[K]['returns']> {
        return this.internalCall(tool as string, params as Record<string, unknown>, options) as Promise<IServiceToolRegistry[K]['returns']>;
    }

    public emit<K extends keyof EventRegistry>(event: K, payload: EventRegistry[K], options?: { skipNetwork?: boolean }): void {
        const packet: IMeshPacket = {
            id: nanoid(),
            topic: event as string,
            data: payload,
            senderNodeID: this.nodeID,
            type: 'EVENT',
            timestamp: Date.now(),
            version: 1,
            priority: 1,
            meta: { local: true }
        };

        this._triggerLocal(event as string, payload, packet);

        if (this.network && !options?.skipNetwork) {
            this.network.publish(event as string, payload);
        }
    }

    private async internalCall(
        toolName: string,
        params: Record<string, unknown>,
        options?: ICallOptions<IMeshMeta>,
        parentCtx?: IContext<Record<string, unknown>, Record<string, unknown>>
    ): Promise<unknown> {
        const schema = MeshToolSchemaRegistry.get(toolName);
        if (schema?.params && params !== undefined) {
            try {
                if (typeof (schema.params as z.ZodTypeAny).parse === 'function') {
                    params = (schema.params as z.ZodTypeAny).parse(params) as Record<string, unknown>;
                }
            } catch (error) {
                throw new Error(`[ServiceBroker] Invalid params for tool ${toolName}: ${error}`);
            }
        } else if (params === undefined) {
            params = {};
        }

        let targetNodeID = options?.nodeID;

        if (!targetNodeID && !this.localTools.has(toolName)) {
            if (this.registry) {
                const endpoint = this.registry.selectNode(toolName, {
                    toolName: toolName,
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

        const timeout = options?.timeout !== undefined ? options.timeout : schema?.timeout;

        const ctx: IContext<Record<string, unknown>, IMeshMeta> = {
            id: nanoid(),
            correlationID: activeCtx?.correlationID || nanoid(),
            toolName,
            params: params,
            meta: { ...(activeCtx?.meta as IMeshMeta), ...(options?.meta as IMeshMeta), timeout },
            targetNodeID: targetNodeID,
            callerID: activeCtx?.id || null,
            nodeID: this.nodeID,
            traceId,
            spanId,
            parentId,
        };

        const timeoutMs = this.evaluateTimeout(ctx.meta?.timeout as number, schema?.timeout);
        let timer: ReturnType<typeof setTimeout> | undefined;

        const resultPromise = this.handlePipeline(ctx);
        let result: unknown;

        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
                reject(new Error(`[ServiceBroker] RPC Timeout calling ${toolName} locally after ${timeoutMs}ms`));
            }, timeoutMs);
        });

        try {
            result = await Promise.race([resultPromise, timeoutPromise]);
        } finally {
            if (timer) SafeTimer.clearTimeout(timer);
        }

        if (schema?.returns) {
            const isCrudProjection = schema.isCrud && ctx.params && (ctx.params.fields !== undefined);
            if (isCrudProjection) {
                return result;
            }
            return (schema.returns as z.ZodTypeAny).parse(result);
        }
        return result;
    }

    public async handleIncomingRPC(packet: IMeshPacket): Promise<unknown> {
        const meta = (packet.meta as Record<string, unknown>) || {};
        const targetNodeID = (meta.finalDestinationID as string) || packet.targetNodeID;

        const ctx: IContext<Record<string, unknown>, IMeshMeta> = {
            id: packet.id,
            correlationID: (packet.meta?.correlationID as string) || packet.id,
            toolName: packet.topic,
            params: packet.data as Record<string, unknown>,
            meta: meta as IMeshMeta,
            callerID: packet.senderNodeID,
            nodeID: this.nodeID,
            targetNodeID: targetNodeID,
            traceId: (meta.traceId as string) || nanoid(),
            spanId: (meta.spanId as string) || nanoid(),
            parentId: meta.parentId as string,
        };

        const schema = MeshToolSchemaRegistry.get(packet.topic);
        const timeoutMs = this.evaluateTimeout(ctx.meta?.timeout as number, schema?.timeout);
        let timer: ReturnType<typeof setTimeout> | undefined;

        const resultPromise = this.handlePipeline(ctx);
        let result: unknown;

        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
                reject(new Error(`[ServiceBroker] RPC Timeout calling ${packet.topic} locally (from network) after ${timeoutMs}ms`));
            }, timeoutMs);
        });

        try {
            result = await Promise.race([resultPromise, timeoutPromise]);
        } finally {
            if (timer) SafeTimer.clearTimeout(timer);
        }

        if (schema?.returns) {
            const isCrudProjection = schema.isCrud && ctx.params && (ctx.params.fields !== undefined);
            if (isCrudProjection) {
                return result;
            }
            return (schema.returns as z.ZodTypeAny).parse(result);
        }
        return result;
    }

    public async handlePipeline(ctx: IContext<Record<string, unknown>, IMeshMeta>): Promise<unknown> {
        return await ContextStack.run(ctx, async () => {
            try {
                const finalHandler = async () => {
                    const isLocal = !ctx.targetNodeID || ctx.targetNodeID === this.nodeID;
                    if (isLocal) {
                        const tool = this.localTools.get(ctx.toolName);
                        if (!tool) {
                            // "Local tool not found" collapses three genuinely different
                            // situations into one unhelpful message -- distinguish them:
                            // (1) this broker has nothing mounted at all (a bare CLI/client
                            //     process, or a node that never finished booting);
                            // (2) the contract is known (schema registered) but no live
                            //     node currently advertises it -- a reachability/bootstrap
                            //     problem, not a naming problem; (3) genuinely unknown name,
                            //     possibly a typo -- surface same-domain siblings if any.
                            const knownSchema = MeshToolSchemaRegistry.get(ctx.toolName);
                            const registeredTools = Array.from(this.localTools.keys());
                            const domain = ctx.toolName.split('.')[0];
                            const sameDomainTools = registeredTools.filter((t) => t.startsWith(`${domain}.`));

                            let reason: string;
                            if (registeredTools.length === 0) {
                                reason = 'this broker has no local tools mounted at all -- likely a bare CLI/client process with no services attached (e.g. `mesh start --services <dir>` was never run here), or it never finished booting';
                            } else if (knownSchema) {
                                reason = 'the contract is defined (schema registered), but no node currently advertising it was reachable -- check whether the owning service is running and connected to this mesh (bootstrap URL correct?), this is a reachability problem, not a naming problem';
                            } else if (sameDomainTools.length > 0) {
                                reason = `not a registered action under domain "${domain}" -- did you mean one of: ${sameDomainTools.join(', ')}?`;
                            } else {
                                reason = `no domain "${domain}" is mounted anywhere on this broker -- likely a typo, or that service isn't started`;
                            }

                            this.logger.error(`[ServiceBroker] Tool not found: ${ctx.toolName} -- ${reason}`, {
                                targetNodeID: ctx.targetNodeID,
                                nodeID: this.nodeID,
                                registeredToolCount: registeredTools.length,
                                ...(sameDomainTools.length > 0 ? { sameDomainTools } : {})
                            });
                            throw new Error(`[ServiceBroker] Local tool not found: ${ctx.toolName} -- ${reason}`);
                        }

                        let parsedParams = ctx.params;
                        const schema = MeshToolSchemaRegistry.get(ctx.toolName);
                        if (schema?.params) {
                            parsedParams = schema.params.parse(ctx.params);
                        }

                        return await tool.handler({ ...ctx, params: parsedParams } as IContext<Record<string, unknown>, Record<string, unknown>>);
                    } else {
                        return await this.executeRemote(ctx.targetNodeID!, ctx.toolName, ctx.params, ctx.meta as Record<string, unknown>);
                    }
                };

                const isLocalInitially = !ctx.targetNodeID || ctx.targetNodeID === this.nodeID;
                const chain = [...this.globalMiddleware];
                if (isLocalInitially) {
                    chain.push(...this.localMiddleware);
                }

                return await this.executeChain(ctx as IContext<Record<string, unknown>, Record<string, unknown>>, chain, finalHandler);

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

    public async executeRemote(nodeID: string, toolName: string, params: unknown, meta: Record<string, unknown> = {}): Promise<unknown> {
        if (!this.network) throw new Error('[ServiceBroker] Network not initialized');

        const requestId = (meta.correlationID as string) || (meta.id as string) || nanoid();

        const currentCtx = this.getContext();
        const tracingMeta = {
            traceId: currentCtx?.traceId,
            spanId: currentCtx?.spanId,
            parentId: currentCtx?.parentId
        };

        const schema = MeshToolSchemaRegistry.get(toolName);
        let remoteTimeout: number | undefined;
        if (!schema && this.registry) {
            const endpoint = this.registry.getNextToolEndpoint(toolName);
            if (endpoint?.tool?.timeout !== undefined) remoteTimeout = endpoint.tool.timeout as number;
        }

        const timeoutMs = this.evaluateTimeout(meta.timeout as number, schema?.timeout, remoteTimeout);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                this.logger.info('Nodes available at timeout:', this.registry.getNodes().map(n => n.nodeID));
                reject(new Error(`[ServiceBroker] RPC Timeout calling ${toolName} on ${nodeID} after ${timeoutMs}ms`));
            }, timeoutMs);

            this.pendingRequests.set(requestId, {
                resolve,
                reject,
                timeout
            });

            this.network.send(nodeID, toolName, params, {
                id: requestId,
                type: 'REQUEST',
                meta: { ...meta, ...tracingMeta, timeout: timeoutMs, correlationID: requestId },
                senderNodeID: this.nodeID,
                topic: toolName
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
            if (module.onStart) {
                await module.onStart(this);
            }
        }
    }

    public async stop(): Promise<void> {
        this.isStarted = false;

        for (const module of this.modules) {
            if (module.onStop) {
                await module.onStop(this);
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
}
