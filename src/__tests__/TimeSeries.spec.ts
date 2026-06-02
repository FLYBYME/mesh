import { z } from 'zod';
import { defineTimeSeries, TimeSeriesParamsSchema, TimeSeriesAggregateParamsSchema } from '../interfaces/ITimeSeriesContract.js';
import { ServiceModule } from '../core/ServiceModule.js';
import { createTestApp, destroyTestApp, dropTestDatabase } from '../testing/TestHelpers.js';
import { IServiceBroker } from '../interfaces/IServiceBroker.js';
import { IServiceToolRegistry } from '../interfaces/IServiceContext.js';
import { IMeshApp } from '../interfaces/IMeshApp.js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true } as any);

interface TelemetryData {
    cpu: number;
    temp: number;
    timestamp: Date;
    tags: Record<string, string>;
}

// --- Type Augmentation for Tests ---
declare global {
    interface IServiceToolRegistry {
        'telemetry.insert': {
            params: { cpu: number; temp: number; timestamp?: Date; tags?: Record<string, string> }[];
            returns: { count: number };
        };
        'telemetry.query': {
            params: z.input<typeof TimeSeriesParamsSchema>;
            returns: TelemetryData[];
        };
        'telemetry.aggregate': {
            params: z.input<typeof TimeSeriesAggregateParamsSchema>;
            returns: Record<string, unknown>[];
        };
        'telemetry.latest': {
            params: { tags?: Record<string, string> };
            returns: TelemetryData | undefined;
        };
    }
}

describe('TimeSeries Contracts & Integration', () => {
    const MetricSchema = z.object({
        cpu: z.number(),
        temp: z.number()
    });

    const TelemetryContracts = defineTimeSeries('telemetry', MetricSchema);

    describe('defineTimeSeries()', () => {
        it('should generate all standard TS contracts', () => {
            const ts = TelemetryContracts;

            expect(ts.domain).toBe('telemetry');
            expect(ts.insert).toBeDefined();
            expect(ts.query).toBeDefined();
            expect(ts.aggregate).toBeDefined();
            expect(ts.latest).toBeDefined();

            expect(ts.insert.action).toBe('insert');
            expect(ts.insert.isTimeSeries).toBe(true);
        });

        it('should enrich output schema with timestamp and tags', () => {
            const ts = TelemetryContracts;
            const output = ts.outputSchema.parse({
                cpu: 10,
                temp: 40,
                timestamp: new Date(),
                tags: { host: 'localhost' }
            });

            expect(output.timestamp).toBeInstanceOf(Date);
            expect(output.tags.host).toBe('localhost');
        });
    });

    describe('Integration Tests', () => {
        let app: IMeshApp;
        let broker: IServiceBroker;
        let dbName: string;

        class TelemetryService extends ServiceModule {
            public readonly domain = 'telemetry';
            constructor() {
                super();
                this.mountTimeSeries(TelemetryContracts);
            }
        }

        beforeAll(async () => {
            const setup = await createTestApp({
                modules: [new TelemetryService()]
            });
            app = setup.app;
            dbName = setup.dbName;
            broker = app.getProvider<IServiceBroker>('broker');
        });

        afterAll(async () => {
            await destroyTestApp(app as any); // TestHelpers expects MeshApp, which is IMeshApp compatible but sometimes private fields cause issues in Jest
            await dropTestDatabase(dbName);
        });

        it('should insert and query points', async () => {
            const now = new Date();
            const points = [
                { cpu: 10, temp: 40, timestamp: new Date(now.getTime() - 2000), tags: { host: 'A' } },
                { cpu: 20, temp: 50, timestamp: new Date(now.getTime() - 1000), tags: { host: 'A' } },
                { cpu: 30, temp: 60, timestamp: now, tags: { host: 'B' } }
            ];

            await broker.call('telemetry.insert', points);

            // Query all
            const all = await broker.call('telemetry.query', {});
            expect(all).toBeDefined();
            expect(all.length).toBe(3);

            // Filter by tags
            const hostA = await broker.call('telemetry.query', { tags: { host: 'A' } });
            expect(hostA).toBeDefined();
            expect(hostA.length).toBe(2);

            // Filter by time
            const recent = await broker.call('telemetry.query', { from: new Date(now.getTime() - 500) });
            expect(recent).toBeDefined();
            expect(recent.length).toBe(1);
            expect(recent[0].cpu).toBe(30);
        });

        it('should fetch latest point', async () => {
            const latest = await broker.call('telemetry.latest', { tags: { host: 'A' } });
            expect(latest).toBeDefined();
            expect(latest?.cpu).toBe(20);
        });

        it('should aggregate data', async () => {
            // Insert more data for aggregation
            const baseTime = new Date('2026-01-01T10:00:00Z');
            const data = [];
            for (let i = 0; i < 60; i++) {
                data.push({
                    cpu: i,
                    temp: 100 - i,
                    timestamp: new Date(baseTime.getTime() + i * 1000), // 1 point per second for 1 minute
                    tags: { host: 'C' }
                });
            }
            await broker.call('telemetry.insert', data);

            const result = await broker.call('telemetry.aggregate', {
                from: baseTime,
                to: new Date(baseTime.getTime() + 60000),
                tags: { host: 'C' },
                interval: '1m',
                aggregates: {
                    cpu: 'avg',
                    temp: 'max'
                }
            });

            expect(result).toBeDefined();
            expect(result.length).toBe(1);
            const firstRow = result[0];
            expect(typeof firstRow.cpu === 'number' ? firstRow.cpu : 0).toBeCloseTo(29.5); // avg of 0..59
            expect(firstRow.temp).toBe(100); // max of 100..41
        });
    });
});
