import fs from 'node:fs';
import path from 'node:path';

/**
 * The browser entry must never reach perf_hooks: nodeMetrics (event loop, CPU, memory) is exported
 * from `./node` only, and the registry the broker and transports record into is plain TypeScript.
 * A static walk of browser.ts's relative imports, so a later `export *` that drags nodeMetrics in
 * fails here rather than in a web bundler.
 */
describe('browser entry', () => {
    const srcRoot = path.resolve(__dirname, '..', '..');
    const importPattern = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g;

    function reachable(entry: string): { files: Set<string>; bare: Set<string> } {
        const files = new Set<string>();
        const bare = new Set<string>();
        const queue = [entry];
        while (queue.length > 0) {
            const file = queue.pop();
            if (file === undefined || files.has(file)) continue;
            files.add(file);
            const source = fs.readFileSync(file, 'utf8');
            for (const match of source.matchAll(importPattern)) {
                const spec = match[1] ?? match[2];
                if (spec === undefined) continue;
                if (!spec.startsWith('.')) {
                    bare.add(spec);
                    continue;
                }
                const resolved = path.resolve(path.dirname(file), spec.replace(/\.js$/, '.ts'));
                if (fs.existsSync(resolved)) queue.push(resolved);
                else if (fs.existsSync(path.join(resolved.replace(/\.ts$/, ''), 'index.ts'))) queue.push(path.join(resolved.replace(/\.ts$/, ''), 'index.ts'));
            }
        }
        return { files, bare };
    }

    it('reaches the metrics registry but never nodeMetrics or perf_hooks', () => {
        const { files, bare } = reachable(path.join(srcRoot, 'browser.ts'));
        const relative = [...files].map((f) => path.relative(srcRoot, f));

        expect(relative).toContain(path.join('metrics', 'MetricsRegistry.ts'));
        expect(relative).toContain(path.join('metrics', 'MeshMetrics.ts'));
        expect(relative).not.toContain(path.join('metrics', 'nodeMetrics.ts'));
        expect([...bare].filter((b) => b.includes('perf_hooks'))).toEqual([]);
    });

    it('exports nodeMetrics from the node entry', () => {
        const { files } = reachable(path.join(srcRoot, 'node.ts'));
        expect([...files].map((f) => path.relative(srcRoot, f))).toContain(path.join('metrics', 'nodeMetrics.ts'));
    });
});
