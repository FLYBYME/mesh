import { MeshError, ResiliencyError, ClientError } from '../../src/core/MeshError.js';

describe('MeshError', () => {
    it('should create a MeshError from a string', () => {
        const error = new MeshError('Something went wrong');
        expect(error.message).toBe('Something went wrong');
        expect(error.code).toBe('INTERNAL_ERROR');
        expect(error.status).toBe(500);
        expect(error.name).toBe('MeshError');
    });

    it('should create a MeshError from a payload', () => {
        const payload = {
            code: 'NOT_FOUND',
            message: 'Resource not found',
            status: 404,
            data: { id: 123 },
            correlationId: 'abc-123'
        };
        const error = new MeshError(payload);
        expect(error.message).toBe(payload.message);
        expect(error.code).toBe(payload.code);
        expect(error.status).toBe(payload.status);
        expect(error.data).toEqual(payload.data);
        expect(error.correlationId).toBe(payload.correlationId);
    });

    it('should validate payload using Zod', () => {
        // @ts-ignore
        expect(() => new MeshError({ status: 'invalid' })).toThrow();
    });

    it('should preserve stack trace if provided in payload', () => {
        const stack = 'Error: custom stack\n    at Object.<anonymous> (test.ts:1:1)';
        const error = new MeshError({
            code: 'ERROR',
            message: 'Original message',
            status: 500,
            stack
        });

        expect(error.stack).toBe(stack);
    });

    it('should serialize to JSON correctly', () => {
        const error = new MeshError({
            code: 'NOT_FOUND',
            message: 'Resource not found',
            status: 404,
            data: { id: 123 },
            correlationId: 'abc-123'
        });
        const json = error.toJSON();
        expect(json.code).toBe('NOT_FOUND');
        expect(json.message).toBe('Resource not found');
        expect(json.status).toBe(404);
        expect(json.data).toEqual({ id: 123 });
        expect(json.correlationId).toBe('abc-123');
        expect(json.stack).toBe(error.stack);
    });

    describe('ResiliencyError', () => {
        it('should have correct default values', () => {
            const error = new ResiliencyError('Service busy');
            expect(error.message).toBe('Service busy');
            expect(error.code).toBe('SERVICE_UNAVAILABLE');
            expect(error.status).toBe(503);
            expect(error.name).toBe('ResiliencyError');
        });

        it('should allow custom code and status', () => {
            const error = new ResiliencyError('Too many requests', 'RATE_LIMIT_EXCEEDED', 429);
            expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
            expect(error.status).toBe(429);
        });
    });

    describe('ClientError', () => {
        it('should have correct default values', () => {
            const error = new ClientError('Invalid input');
            expect(error.message).toBe('Invalid input');
            expect(error.code).toBe('BAD_REQUEST');
            expect(error.status).toBe(400);
            expect(error.name).toBe('ClientError');
        });

        it('should allow custom code and status', () => {
            const error = new ClientError('Forbidden', 'FORBIDDEN', 403);
            expect(error.code).toBe('FORBIDDEN');
            expect(error.status).toBe(403);
        });
    });
});
