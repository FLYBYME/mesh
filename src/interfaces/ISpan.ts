/**
 * One unit of work in a trace: a call handled, an event handled, a database operation. Recorded on
 * the node that did the work, with its parent's span, so a request's whole path can be put back
 * together from every node's spans (`traceId`). Field names follow OpenTelemetry's where they have
 * one, so moving to a trace store later is a change of where spans go, not of what they say.
 *
 * Nothing is recorded until a sink is set (`IServiceBroker.setSpanSink`): no sink, no cost.
 */
export interface Span {
    readonly traceId: string;
    readonly spanId: string;
    readonly parentId?: string;
    /** `call`: a contract handled here; `event`: an event handler; `db`: a database operation. */
    readonly kind: 'call' | 'event' | 'db';
    /** The contract (`repo.find`), the event (`card.created`), or the collection and action. */
    readonly name: string;
    readonly nodeID: string;
    /** The organization it ran for, when it ran for one. */
    readonly organization?: string;
    /** Epoch milliseconds. */
    readonly startedAt: number;
    readonly durationMs: number;
    readonly outcome: 'ok' | 'error' | 'timeout';
    /** What failed, when it did: the error's message. */
    readonly error?: string;
}

export type SpanSink = (span: Span) => void;
