import { Logger } from '../utils/Logger.js';
import { LogLevel } from '../interfaces/ILogger.js';

describe('Logger', () => {
    let logger: Logger;
    let consoleDebugSpy: jest.SpyInstance;
    let consoleInfoSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        logger = new Logger(LogLevel.DEBUG);
        consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation(() => { });
        consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => { });
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should log debug messages when level is DEBUG', () => {
        logger.debug('debug msg');
        expect(consoleDebugSpy).toHaveBeenCalled();
        expect(consoleDebugSpy.mock.calls[0][0]).toContain('debug msg');
    });

    it('should NOT log debug messages when level is INFO', () => {
        logger.setLevel(LogLevel.INFO);
        logger.debug('debug msg');
        expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('should log info messages when level is INFO', () => {
        logger.setLevel(LogLevel.INFO);
        logger.info('info msg', { foo: 'bar' });
        expect(consoleInfoSpy).toHaveBeenCalled();
        expect(consoleInfoSpy.mock.calls[0][0]).toContain('info msg');
        expect(consoleInfoSpy.mock.calls[0][1]).toEqual({ foo: 'bar' });
    });

    it('should NOT log info messages when level is WARN', () => {
        logger.setLevel(LogLevel.WARN);
        logger.info('info msg');
        expect(consoleInfoSpy).not.toHaveBeenCalled();
    });

    it('should log warn messages when level is WARN', () => {
        logger.setLevel(LogLevel.WARN);
        logger.warn('warn msg');
        expect(consoleWarnSpy).toHaveBeenCalled();
        expect(consoleWarnSpy.mock.calls[0][0]).toContain('warn msg');
    });

    it('should NOT log warn messages when level is ERROR', () => {
        logger.setLevel(LogLevel.ERROR);
        logger.warn('warn msg');
        expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should log error messages when level is ERROR', () => {
        logger.setLevel(LogLevel.ERROR);
        logger.error('error msg');
        expect(consoleErrorSpy).toHaveBeenCalled();
        expect(consoleErrorSpy.mock.calls[0][0]).toContain('error msg');
    });

    it('should include context in formatting', () => {
        const ctxLogger = new Logger(LogLevel.INFO, { requestId: '123' });
        ctxLogger.info('test');
        expect(consoleInfoSpy).toHaveBeenCalled();
        expect(consoleInfoSpy.mock.calls[0][0]).toContain('{"requestId":"123"}');
    });

    it('should create child logger merging context', () => {
        const parent = new Logger(LogLevel.INFO, { parentId: '1' });
        const child = parent.child({ childId: '2' });

        child.info('test');
        expect(consoleInfoSpy).toHaveBeenCalled();
        const output = consoleInfoSpy.mock.calls[0][0];
        expect(output).toContain('"parentId":"1"');
        expect(output).toContain('"childId":"2"');
        expect(child.getLevel()).toBe(LogLevel.INFO);
    });

    it('should include ISO timestamp', () => {
        logger.info('time test');
        expect(consoleInfoSpy).toHaveBeenCalled();
        const output = consoleInfoSpy.mock.calls[0][0];
        // Matches roughly [2026-05-26T...Z]
        expect(output).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });
});
