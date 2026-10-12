import { databaseNameOf } from '../../db/Database.js';

describe('databaseNameOf: the database a connection string names', () => {
    it('reads it after one host, or after a replica set\'s several', () => {
        expect(databaseNameOf('mongodb://u:p@db:27017/surfdns?authSource=admin')).toBe('surfdns');
        // new URL() throws on this one: the reason the name was lost (one-host.ca, 2026-10-12).
        expect(databaseNameOf('mongodb://u:p@10.250.0.4:27017,10.250.0.2:27017,10.250.0.3:27017/surfdns?authSource=admin&replicaSet=platform')).toBe('surfdns');
        expect(databaseNameOf('mongodb+srv://u:p@cluster0.example.net/surfdns?retryWrites=true')).toBe('surfdns');
    });

    it('keeps encoded credentials out of it', () => {
        expect(databaseNameOf('mongodb://u:p%2Fw%40rd@db:27017/surfdns')).toBe('surfdns');
    });

    it('is undefined when none is named', () => {
        expect(databaseNameOf('mongodb://localhost:27017')).toBeUndefined();
        expect(databaseNameOf('mongodb://localhost:27017/')).toBeUndefined();
        expect(databaseNameOf('mongodb://localhost:27017/?replicaSet=rs0')).toBeUndefined();
    });
});
