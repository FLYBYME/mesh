import { MeshError, ResiliencyError, ClientError, MeshErrorPayloadSchema } from './MeshError.js';

describe('MeshError', () => {
    describe('MeshError constructor', () => {
        it('should construct from a string payload', () => {
            const error = new MeshError('Something went wrong');
            expect(error.message).toBe('Something went wrong');
            expect(error.code).toBe('INTERNAL_ERROR');
            expect(error.status).toBe(500);
            expect(error.name).toBe('MeshError');
        });

        it('should construct from a complete MeshErrorPayload object', () => {
            const payload = {
                message: 'Custom error message',
                code: 'CUSTOM_CODE',
                status: 404,
                data: { foo: 'bar' },
                correlationId: 'req-123'
            };
            const error = new MeshError(payload);
            
            expect(error.message).toBe('Custom error message');
            expect(error.code).toBe('CUSTOM_CODE');
            expect(error.status).toBe(404);
            expect(error.data).toEqual({ foo: 'bar' });
            expect(error.correlationId).toBe('req-123');
        });

        it('should throw when constructed with an invalid payload object', () => {
            expect(() => {
                new MeshError({ status: 'not-a-number' } as any);
            }).toThrow();
        });
    });

    describe('toJSON()', () => {
        it('should serialize correctly', () => {
            const error = new MeshError({
                message: 'Error to serialize',
                code: 'SER_ERR',
                status: 501,
                correlationId: '123'
            });
            const json = error.toJSON();
            
            expect(json).toHaveProperty('message', 'Error to serialize');
            expect(json).toHaveProperty('code', 'SER_ERR');
            expect(json).toHaveProperty('status', 501);
            expect(json).toHaveProperty('correlationId', '123');
            expect(json).toHaveProperty('stack');
        });

        it('should round-trip through JSON and Zod validation', () => {
            const error = new MeshError('Round trip test');
            const json = error.toJSON();
            
            // Should pass zod validation
            const parsed = MeshErrorPayloadSchema.parse(json);
            expect(parsed.message).toBe('Round trip test');
            expect(parsed.code).toBe('INTERNAL_ERROR');
        });
    });
});

describe('ResiliencyError', () => {
    it('should have correct defaults', () => {
        const err = new ResiliencyError('Rate limited');
        expect(err.message).toBe('Rate limited');
        expect(err.code).toBe('SERVICE_UNAVAILABLE');
        expect(err.status).toBe(503);
        expect(err.name).toBe('ResiliencyError');
    });

    it('should allow overriding code and status', () => {
        const err = new ResiliencyError('Too many requests', 'TOO_MANY_REQUESTS', 429);
        expect(err.code).toBe('TOO_MANY_REQUESTS');
        expect(err.status).toBe(429);
    });
});

describe('ClientError', () => {
    it('should have correct defaults', () => {
        const err = new ClientError('Invalid input');
        expect(err.message).toBe('Invalid input');
        expect(err.code).toBe('BAD_REQUEST');
        expect(err.status).toBe(400);
        expect(err.name).toBe('ClientError');
    });

    it('should allow overriding code and status', () => {
        const err = new ClientError('Forbidden access', 'FORBIDDEN', 403);
        expect(err.code).toBe('FORBIDDEN');
        expect(err.status).toBe(403);
    });
});
