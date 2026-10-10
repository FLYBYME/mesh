import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing, once for every service. Before 10-10 there were four copies -- identity
 * (mesh-serve), mail, imapserver, smtpserver -- in two stored formats, and two argument orders for
 * verify: identity's (password, stored) and mail's (hash, plain), a swap that type-checks and fails
 * every sign-in. Verify takes named fields so it cannot be swapped.
 *
 * Stored as `scrypt:<saltHex>:<hashHex>`. The older `<saltHex>:<hashHex>` identity wrote is read
 * too, so no stored password has to change.
 */
const KEY_LENGTH = 64;

/** scrypt as a promise of its key (promisify loses the overloads' Buffer type). */
function derive(password: string, salt: Buffer, length: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scrypt(password, salt, length, (err, key) => (err !== null ? reject(err) : resolve(key)));
    });
}

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await derive(password, salt, KEY_LENGTH);

    return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

/**
 * Whether `password` is the one `stored` was made from. A stored value in neither format is a
 * failed sign-in, never a thrown error.
 */
export async function verifyPassword(check: { readonly password: string; readonly stored: string }): Promise<boolean> {
    const parts = check.stored.split(':');
    const [saltHex, hashHex] = parts.length === 3 && parts[0] === 'scrypt' ? parts.slice(1) : parts.length === 2 ? parts : [];
    if (saltHex === undefined || hashHex === undefined || saltHex === '' || hashHex === '') return false;

    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    if (salt.length === 0 || expected.length === 0) return false;

    const derived = await derive(check.password, salt, expected.length);

    return derived.length === expected.length && timingSafeEqual(derived, expected);
}
