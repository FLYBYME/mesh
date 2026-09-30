/**
 * MetricsRegistry: counters, gauges and fixed-bucket histograms, rendered in the Prometheus text
 * exposition format (0.0.4) -- what VictoriaMetrics scrapes.
 *
 * Why not prom-client: mesh is also a browser bundle, and this needs nothing a browser lacks. Why
 * it exists at all: on 2026-09-30 every mesh node burned about half a CPU core and api calls took
 * 2-13 s, and the cause (gossip resending full catalogs every 10-15 s, fixed in v4.9.0) was found
 * only by hand-counting WebSocket bytes on a laptop. A node now says, per scrape, which actions it
 * serves, how long they take, how busy its event loop is, and what each topic costs on the wire.
 *
 * **Cardinality is bounded here, not trusted to the callers.** Every label set is a series held in
 * memory for the life of the process and a series in the database forever after. Callers label
 * only by bounded sets (action names, topics, outcomes), but a topic or an action name can arrive
 * from a peer, so each metric also caps its own series: past `maxSeries`, new label sets are
 * folded into one series whose every label is `OVERFLOW_LABEL`. A graph showing that series is
 * the signal that something is labelling by an id.
 *
 * Deliberately no node label anywhere: the scraper adds `instance`/`node` itself, and a node label
 * here would only disagree with it.
 */

/** Label values, in the order the metric's labelNames were declared. */
export type LabelValues = readonly string[];

/** What every label is set to on the series a metric folds new label sets into past its cap. */
export const OVERFLOW_LABEL = '__overflow__';

/** The Content-Type a /metrics response is served with. */
export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/** Series per metric before new label sets are folded into the overflow series. */
export const DEFAULT_MAX_SERIES = 1000;

export type MetricType = 'counter' | 'gauge' | 'histogram';

export interface MetricOptions {
    /** See the class comment. Defaults to DEFAULT_MAX_SERIES. */
    readonly maxSeries?: number;
}

const METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function escapeLabelValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function escapeHelp(help: string): string {
    return help.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

/** A sample value as the text format spells it: `+Inf`, `-Inf`, `NaN`, or a plain number. */
export function formatSampleValue(value: number): string {
    if (Number.isNaN(value)) return 'NaN';
    if (value === Infinity) return '+Inf';
    if (value === -Infinity) return '-Inf';
    return String(value);
}

/** `{a="x",b="y"}`, or '' for no labels. `extra` is appended last (a histogram's `le`). */
function renderLabels(names: readonly string[], values: LabelValues, extra?: string): string {
    if (names.length === 0 && extra === undefined) return '';
    const parts: string[] = [];
    for (let i = 0; i < names.length; i++) {
        parts.push(`${names[i]}="${escapeLabelValue(values[i] ?? '')}"`);
    }
    if (extra !== undefined) parts.push(extra);
    return `{${parts.join(',')}}`;
}

/** A counter's series resolved once -- see Counter.bind. */
export interface BoundCounter {
    inc(by?: number): void;
}

/** A histogram's series resolved once -- see Histogram.bind. */
export interface BoundHistogram {
    observe(value: number): void;
}

abstract class Metric<S extends { readonly values: LabelValues }> {
    abstract readonly type: MetricType;
    protected readonly series = new Map<string, S>();
    private readonly maxSeries: number;
    /** Bumped by reset(), so a bound series knows the one it holds is no longer rendered. */
    protected generation = 0;

    constructor(
        public readonly name: string,
        public readonly help: string,
        public readonly labelNames: readonly string[],
        options: MetricOptions = {},
    ) {
        if (!METRIC_NAME.test(name)) throw new Error(`[metrics] Invalid metric name "${name}"`);
        for (const label of labelNames) {
            if (!LABEL_NAME.test(label) || label.startsWith('__')) {
                throw new Error(`[metrics] Invalid label name "${label}" on ${name}`);
            }
        }
        this.maxSeries = options.maxSeries ?? DEFAULT_MAX_SERIES;
    }

    protected abstract createSeries(values: LabelValues): S;

    /**
     * The series for `values`, created on first use: one join and one Map lookup. The hottest
     * callers (a packet, a call) skip even that through `bind` -- see MeshMetrics.
     */
    protected seriesFor(values: LabelValues): S {
        if (values.length !== this.labelNames.length) {
            throw new Error(`[metrics] ${this.name} takes ${this.labelNames.length} label value(s), got ${values.length}`);
        }
        const key = values.length === 1 ? values[0] : values.join('\u0000');
        const existing = this.series.get(key);
        if (existing !== undefined) return existing;

        if (this.series.size >= this.maxSeries) {
            const overflowValues = this.labelNames.map(() => OVERFLOW_LABEL);
            const overflowKey = overflowValues.join('\u0000');
            const overflow = this.series.get(overflowKey);
            if (overflow !== undefined) return overflow;
            const created = this.createSeries(overflowValues);
            this.series.set(overflowKey, created);
            return created;
        }

        const created = this.createSeries([...values]);
        this.series.set(key, created);
        return created;
    }

    /** Drops every series -- a test's clean slate, or a gauge rebuilt from scratch each scrape. */
    reset(): void {
        this.series.clear();
        this.generation++;
    }

    /** How many label sets this metric currently holds. */
    get size(): number {
        return this.series.size;
    }

    render(out: string[]): void {
        out.push(`# HELP ${this.name} ${escapeHelp(this.help)}`);
        out.push(`# TYPE ${this.name} ${this.type}`);
        this.renderSeries(out);
    }

    protected abstract renderSeries(out: string[]): void;
}

interface ValueSeries {
    readonly values: LabelValues;
    value: number;
}

export class Counter extends Metric<ValueSeries> {
    readonly type = 'counter';

    protected createSeries(values: LabelValues): ValueSeries {
        return { values, value: 0 };
    }

    inc(values: LabelValues = [], by = 1): void {
        if (by < 0) throw new Error(`[metrics] ${this.name}: a counter only goes up`);
        this.seriesFor(values).value += by;
    }

    /**
     * The series for `values`, looked up now instead of on every `inc`. Measured 2026-09-30: the
     * join + lookup was nearly all of a per-packet record's cost (~580 ns for bytes and packets
     * together, ~33 ns bound). Survives reset(): a bound series re-resolves when the metric was reset.
     */
    bind(values: LabelValues): BoundCounter {
        const frozen = [...values];
        let series = this.seriesFor(frozen);
        let generation = this.generation;
        return {
            inc: (by = 1) => {
                if (by < 0) throw new Error(`[metrics] ${this.name}: a counter only goes up`);
                if (generation !== this.generation) {
                    series = this.seriesFor(frozen);
                    generation = this.generation;
                }
                series.value += by;
            },
        };
    }

    /**
     * Mirror a total that some other source already keeps monotonic -- the process's CPU seconds
     * from `process.cpuUsage()`, say. Not for counting: use `inc`.
     */
    setTotal(values: LabelValues, total: number): void {
        this.seriesFor(values).value = total;
    }

    get(values: LabelValues = []): number {
        return this.series.get(values.length === 1 ? values[0] : values.join('\u0000'))?.value ?? 0;
    }

    protected renderSeries(out: string[]): void {
        for (const s of this.series.values()) {
            out.push(`${this.name}${renderLabels(this.labelNames, s.values)} ${formatSampleValue(s.value)}`);
        }
    }
}

export class Gauge extends Metric<ValueSeries> {
    readonly type = 'gauge';

    protected createSeries(values: LabelValues): ValueSeries {
        return { values, value: 0 };
    }

    set(values: LabelValues, value: number): void {
        this.seriesFor(values).value = value;
    }

    inc(values: LabelValues = [], by = 1): void {
        this.seriesFor(values).value += by;
    }

    get(values: LabelValues = []): number {
        return this.series.get(values.length === 1 ? values[0] : values.join('\u0000'))?.value ?? 0;
    }

    protected renderSeries(out: string[]): void {
        for (const s of this.series.values()) {
            out.push(`${this.name}${renderLabels(this.labelNames, s.values)} ${formatSampleValue(s.value)}`);
        }
    }
}

interface HistogramSeries {
    readonly values: LabelValues;
    /** Per-bucket counts, *not* cumulative -- cumulated once at render instead of on every observe. */
    readonly counts: Float64Array;
    sum: number;
    count: number;
}

export class Histogram extends Metric<HistogramSeries> {
    readonly type = 'histogram';
    public readonly buckets: readonly number[];

    constructor(name: string, help: string, labelNames: readonly string[], buckets: readonly number[], options: MetricOptions = {}) {
        super(name, help, labelNames, options);
        if (labelNames.includes('le')) throw new Error(`[metrics] ${name}: "le" is reserved for histogram buckets`);
        const sorted = [...buckets].filter((b) => Number.isFinite(b)).sort((a, b) => a - b);
        if (sorted.length === 0) throw new Error(`[metrics] ${name}: a histogram needs at least one finite bucket`);
        this.buckets = sorted;
    }

    protected createSeries(values: LabelValues): HistogramSeries {
        // One slot past the last bucket for observations above it (+Inf).
        return { values, counts: new Float64Array(this.buckets.length + 1), sum: 0, count: 0 };
    }

    observe(values: LabelValues, value: number): void {
        this.observeInto(this.seriesFor(values), value);
    }

    /** As Counter.bind. */
    bind(values: LabelValues): BoundHistogram {
        const frozen = [...values];
        let series = this.seriesFor(frozen);
        let generation = this.generation;
        return {
            observe: (value: number) => {
                if (generation !== this.generation) {
                    series = this.seriesFor(frozen);
                    generation = this.generation;
                }
                this.observeInto(series, value);
            },
        };
    }

    private observeInto(s: HistogramSeries, value: number): void {
        const buckets = this.buckets;
        let i = 0;
        while (i < buckets.length && value > buckets[i]) i++;
        s.counts[i]++;
        s.sum += value;
        s.count++;
    }

    /** Observation count for one label set -- for tests and for callers that want a quick total. */
    count(values: LabelValues = []): number {
        return this.series.get(values.length === 1 ? values[0] : values.join('\u0000'))?.count ?? 0;
    }

    protected renderSeries(out: string[]): void {
        for (const s of this.series.values()) {
            let cumulative = 0;
            for (let i = 0; i < this.buckets.length; i++) {
                cumulative += s.counts[i];
                const le = `le="${formatSampleValue(this.buckets[i])}"`;
                out.push(`${this.name}_bucket${renderLabels(this.labelNames, s.values, le)} ${cumulative}`);
            }
            cumulative += s.counts[this.buckets.length];
            out.push(`${this.name}_bucket${renderLabels(this.labelNames, s.values, 'le="+Inf"')} ${cumulative}`);
            out.push(`${this.name}_sum${renderLabels(this.labelNames, s.values)} ${formatSampleValue(s.sum)}`);
            out.push(`${this.name}_count${renderLabels(this.labelNames, s.values)} ${s.count}`);
        }
    }
}

type AnyMetric = Counter | Gauge | Histogram;

/** Something run just before each render -- a gauge read from the process, say. */
export type MetricsCollector = () => void;

export class MetricsRegistry {
    private readonly metrics = new Map<string, AnyMetric>();
    private readonly collectors = new Set<MetricsCollector>();

    /**
     * Get-or-create, so two modules (or two brokers in one test process) asking for the same metric
     * share it instead of throwing. Asking for an existing name with a different type or label set
     * is a programming error and throws.
     */
    counter(name: string, help: string, labelNames: readonly string[] = [], options?: MetricOptions): Counter {
        const existing = this.metrics.get(name);
        if (existing !== undefined) {
            if (existing instanceof Counter && this.sameLabels(existing, labelNames)) return existing;
            throw this.conflict(name, 'counter', labelNames);
        }
        const metric = new Counter(name, help, labelNames, options);
        this.metrics.set(name, metric);
        return metric;
    }

    gauge(name: string, help: string, labelNames: readonly string[] = [], options?: MetricOptions): Gauge {
        const existing = this.metrics.get(name);
        if (existing !== undefined) {
            if (existing instanceof Gauge && this.sameLabels(existing, labelNames)) return existing;
            throw this.conflict(name, 'gauge', labelNames);
        }
        const metric = new Gauge(name, help, labelNames, options);
        this.metrics.set(name, metric);
        return metric;
    }

    histogram(name: string, help: string, labelNames: readonly string[], buckets: readonly number[], options?: MetricOptions): Histogram {
        const existing = this.metrics.get(name);
        if (existing !== undefined) {
            if (existing instanceof Histogram && this.sameLabels(existing, labelNames)) return existing;
            throw this.conflict(name, 'histogram', labelNames);
        }
        const metric = new Histogram(name, help, labelNames, buckets, options);
        this.metrics.set(name, metric);
        return metric;
    }

    get(name: string): AnyMetric | undefined {
        return this.metrics.get(name);
    }

    /** Runs before every render. Returns the function that removes it again. */
    addCollector(collector: MetricsCollector): () => void {
        this.collectors.add(collector);
        return () => { this.collectors.delete(collector); };
    }

    /**
     * The whole registry in the text exposition format. Collectors run first; one that throws is
     * skipped rather than failing the scrape -- a scrape that fails loses every other metric too.
     */
    render(): string {
        for (const collector of this.collectors) {
            try {
                collector();
            } catch {
                // See above: one broken collector must not blank the whole page.
            }
        }
        const out: string[] = [];
        for (const metric of this.metrics.values()) metric.render(out);
        return out.length === 0 ? '' : `${out.join('\n')}\n`;
    }

    /** Every series of every metric back to nothing. Metrics and collectors stay registered. */
    resetAll(): void {
        for (const metric of this.metrics.values()) metric.reset();
    }

    private sameLabels(metric: AnyMetric, labelNames: readonly string[]): boolean {
        return metric.labelNames.length === labelNames.length && metric.labelNames.every((l, i) => l === labelNames[i]);
    }

    private conflict(name: string, type: MetricType, labelNames: readonly string[]): Error {
        const existing = this.metrics.get(name);
        return new Error(`[metrics] ${name} is already registered as a ${existing?.type} {${existing?.labelNames.join(',')}}; asked for a ${type} {${labelNames.join(',')}}`);
    }
}
