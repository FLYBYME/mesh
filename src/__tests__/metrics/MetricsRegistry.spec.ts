import { MetricsRegistry, OVERFLOW_LABEL, formatSampleValue } from '../../metrics/MetricsRegistry.js';

/**
 * The text exposition format (0.0.4) exactly as VictoriaMetrics/Prometheus parse it: HELP and TYPE
 * once per metric, one line per series, histogram buckets cumulative with `le` last and a `+Inf`
 * bucket equal to `_count`.
 */
describe('MetricsRegistry exposition', () => {
    it('renders a counter with HELP, TYPE and one line per label set', () => {
        const registry = new MetricsRegistry();
        const calls = registry.counter('mesh_test_calls_total', 'Calls.', ['action', 'outcome']);
        calls.inc(['a.b', 'ok']);
        calls.inc(['a.b', 'ok'], 2);
        calls.inc(['a.c', 'error']);

        expect(registry.render()).toBe([
            '# HELP mesh_test_calls_total Calls.',
            '# TYPE mesh_test_calls_total counter',
            'mesh_test_calls_total{action="a.b",outcome="ok"} 3',
            'mesh_test_calls_total{action="a.c",outcome="error"} 1',
            '',
        ].join('\n'));
    });

    it('renders an unlabelled gauge without braces', () => {
        const registry = new MetricsRegistry();
        registry.gauge('mesh_test_gauge', 'A gauge.').set([], 0.25);
        expect(registry.render()).toContain('\nmesh_test_gauge 0.25\n');
    });

    it('renders a histogram with cumulative buckets, +Inf, _sum and _count', () => {
        const registry = new MetricsRegistry();
        const h = registry.histogram('mesh_test_seconds', 'Durations.', ['action'], [0.1, 1, 0.5]);
        h.observe(['x'], 0.05);
        h.observe(['x'], 0.1); // on a boundary: le is "less than or equal"
        h.observe(['x'], 0.7);
        h.observe(['x'], 3);

        expect(registry.render()).toBe([
            '# HELP mesh_test_seconds Durations.',
            '# TYPE mesh_test_seconds histogram',
            'mesh_test_seconds_bucket{action="x",le="0.1"} 2',
            'mesh_test_seconds_bucket{action="x",le="0.5"} 2',
            'mesh_test_seconds_bucket{action="x",le="1"} 3',
            'mesh_test_seconds_bucket{action="x",le="+Inf"} 4',
            'mesh_test_seconds_sum{action="x"} 3.85',
            'mesh_test_seconds_count{action="x"} 4',
            '',
        ].join('\n'));
    });

    it('escapes backslashes, quotes and newlines in label values, and backslashes and newlines in HELP', () => {
        const registry = new MetricsRegistry();
        registry.counter('mesh_test_escape_total', 'line one\nline \\two', ['topic']).inc(['a"b\\c\nd']);
        const text = registry.render();
        expect(text).toContain('# HELP mesh_test_escape_total line one\\nline \\\\two\n');
        expect(text).toContain('mesh_test_escape_total{topic="a\\"b\\\\c\\nd"} 1\n');
    });

    it('spells non-finite values the way the format does', () => {
        expect(formatSampleValue(Infinity)).toBe('+Inf');
        expect(formatSampleValue(-Infinity)).toBe('-Inf');
        expect(formatSampleValue(Number.NaN)).toBe('NaN');
        expect(formatSampleValue(42)).toBe('42');
    });

    it('renders nothing at all for an empty registry', () => {
        expect(new MetricsRegistry().render()).toBe('');
    });
});

describe('MetricsRegistry bounds and registration', () => {
    it('folds label sets past maxSeries into one overflow series instead of growing', () => {
        const registry = new MetricsRegistry();
        const c = registry.counter('mesh_test_capped_total', 'Capped.', ['topic'], { maxSeries: 3 });
        for (let i = 0; i < 10; i++) c.inc([`topic-${i}`]);

        // Three real series, then everything else in the overflow series.
        expect(c.size).toBe(4);
        expect(c.get([OVERFLOW_LABEL])).toBe(7);
        expect(c.get(['topic-0'])).toBe(1);
        // A label set that already exists keeps counting in its own series.
        c.inc(['topic-1']);
        expect(c.get(['topic-1'])).toBe(2);
    });

    it('returns the same metric for the same name, type and labels, and refuses a conflicting one', () => {
        const registry = new MetricsRegistry();
        const a = registry.counter('mesh_test_shared_total', 'Shared.', ['x']);
        expect(registry.counter('mesh_test_shared_total', 'Shared.', ['x'])).toBe(a);
        expect(() => registry.gauge('mesh_test_shared_total', 'Shared.', ['x'])).toThrow(/already registered as a counter/);
        expect(() => registry.counter('mesh_test_shared_total', 'Shared.', ['y'])).toThrow(/already registered/);
    });

    it('rejects the wrong number of label values, invalid names and a decreasing counter', () => {
        const registry = new MetricsRegistry();
        const c = registry.counter('mesh_test_strict_total', 'Strict.', ['a', 'b']);
        expect(() => c.inc(['only-one'])).toThrow(/takes 2 label value/);
        expect(() => c.inc(['x', 'y'], -1)).toThrow(/only goes up/);
        expect(() => registry.counter('bad-name', 'Bad.')).toThrow(/Invalid metric name/);
        expect(() => registry.counter('mesh_test_bad_label_total', 'Bad.', ['__reserved'])).toThrow(/Invalid label name/);
        expect(() => registry.histogram('mesh_test_le', 'Bad.', ['le'], [1])).toThrow(/reserved/);
    });

    it('keeps a bound series counting into the rendered one across a reset', () => {
        const registry = new MetricsRegistry();
        const c = registry.counter('mesh_test_bound_total', 'Bound.', ['topic']);
        const h = registry.histogram('mesh_test_bound_seconds', 'Bound.', ['topic'], [1]);
        const boundC = c.bind(['t']);
        const boundH = h.bind(['t']);
        boundC.inc(2);
        boundH.observe(0.5);
        expect(c.get(['t'])).toBe(2);
        expect(h.count(['t'])).toBe(1);

        registry.resetAll();
        boundC.inc();
        boundH.observe(2);
        expect(c.get(['t'])).toBe(1);
        expect(registry.render()).toContain('mesh_test_bound_seconds_bucket{topic="t",le="1"} 0\n');
        expect(registry.render()).toContain('mesh_test_bound_seconds_count{topic="t"} 1\n');
    });

    it('runs collectors before rendering, and a throwing collector does not blank the scrape', () => {
        const registry = new MetricsRegistry();
        const g = registry.gauge('mesh_test_collected', 'Collected.');
        let n = 0;
        registry.addCollector(() => { throw new Error('broken collector'); });
        const remove = registry.addCollector(() => { g.set([], ++n); });

        expect(registry.render()).toContain('mesh_test_collected 1\n');
        expect(registry.render()).toContain('mesh_test_collected 2\n');
        remove();
        expect(registry.render()).toContain('mesh_test_collected 2\n');
    });
});
