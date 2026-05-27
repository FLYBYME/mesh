import type { IContext  } from './IContext.js';

export type INextFunction<TReturn = unknown> = () => Promise<TReturn>;

export type IMiddleware<TParams = Record<string, unknown>, TMeta = Record<string, unknown>, TReturn = unknown> = (
    ctx: IContext<TParams, TMeta>,
    next: INextFunction<TReturn>
) => Promise<TReturn>;

/**
 * IInterceptor — Strictly typed middleware interceptor.
 * Can be used for Broker actions (handler) or Network packets (onInbound/onOutbound).
 */
export interface IInterceptor<TIn = unknown, TOut = unknown> {
    name: string;

    /** Used for ServiceBroker action middleware */
    handler?(context: IContext<Record<string, unknown>, Record<string, unknown>>, next: INextFunction<unknown>): Promise<unknown>;

    /** Used for Network packet interception */
    onInbound?(packet: TIn): Promise<TIn> | TIn;
    onOutbound?(packet: TOut): Promise<TOut> | TOut;

    /** Optional lifecycle hook for interceptors that maintain state or timers */
    stop?(): void | Promise<void>;
}
