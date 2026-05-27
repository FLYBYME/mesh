import { SafeTimer } from '../../src/utils/SafeTimer.js';

describe('SafeTimer', () => {
    describe('unref', () => {
        it('should call unref if it exists on the timer object', () => {
            const mockTimer = { unref: jest.fn() };
            SafeTimer.unref(mockTimer as any);
            expect(mockTimer.unref).toHaveBeenCalled();
        });

        it('should not throw if unref does not exist', () => {
            expect(() => SafeTimer.unref({} as any)).not.toThrow();
            expect(() => SafeTimer.unref(123 as any)).not.toThrow();
        });

        it('should handle undefined', () => {
            expect(() => SafeTimer.unref(undefined)).not.toThrow();
        });
    });

    describe('clearInterval', () => {
        it('should call global clearInterval', () => {
            const spy = jest.spyOn(global, 'clearInterval');
            const timer = setInterval(() => {}, 1000);
            SafeTimer.clearInterval(timer as any);
            expect(spy).toHaveBeenCalledWith(timer);
            spy.mockRestore();
        });

        it('should handle undefined', () => {
            expect(() => SafeTimer.clearInterval(undefined)).not.toThrow();
        });
    });

    describe('clearTimeout', () => {
        it('should call global clearTimeout', () => {
            const spy = jest.spyOn(global, 'clearTimeout');
            const timer = setTimeout(() => {}, 1000);
            SafeTimer.clearTimeout(timer as any);
            expect(spy).toHaveBeenCalledWith(timer);
            spy.mockRestore();
        });

        it('should handle undefined', () => {
            expect(() => SafeTimer.clearTimeout(undefined)).not.toThrow();
        });
    });
});
