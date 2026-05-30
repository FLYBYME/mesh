import { SafeTimer } from '../utils/SafeTimer.js';

describe('SafeTimer', () => {
    describe('unref()', () => {
        it('should call unref on Node timers', () => {
            const mockTimer = { unref: jest.fn() };
            SafeTimer.unref(mockTimer as any);
            expect(mockTimer.unref).toHaveBeenCalled();
        });

        it('should be a no-op for plain numbers (browser timers)', () => {
            expect(() => SafeTimer.unref(123 as any)).not.toThrow();
        });

        it('should be a no-op for undefined', () => {
            expect(() => SafeTimer.unref(undefined)).not.toThrow();
        });
    });

    describe('clearInterval()', () => {
        it('should clear an interval', () => {
            const spy = jest.spyOn(global, 'clearInterval');
            const timer = setInterval(() => { }, 1000);
            SafeTimer.clearInterval(timer as any);
            expect(spy).toHaveBeenCalledWith(timer);
            spy.mockRestore();
        });

        it('should be a no-op for undefined', () => {
            const spy = jest.spyOn(global, 'clearInterval');
            SafeTimer.clearInterval(undefined);
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });
    });

    describe('clearTimeout()', () => {
        it('should clear a timeout', () => {
            const spy = jest.spyOn(global, 'clearTimeout');
            const timer = setTimeout(() => { }, 1000);
            SafeTimer.clearTimeout(timer as any);
            expect(spy).toHaveBeenCalledWith(timer);
            spy.mockRestore();
        });

        it('should be a no-op for undefined', () => {
            const spy = jest.spyOn(global, 'clearTimeout');
            SafeTimer.clearTimeout(undefined);
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });
    });
});
