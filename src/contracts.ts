/**
 * `@flybyme/mesh/contracts` — the declaration layer, and the only entry a browser can load.
 *
 * ## Why this exists
 *
 * A contract's schemas are the one thing both halves of a platform share: the server validates a
 * request with them, and a browser builds a form from the same object. So browser code needs `z`,
 * and it must be *this* package's `z`.
 *
 * That is not a stylistic preference. zod's type checks are `instanceof`, which compares constructor
 * identity — so two copies of zod on one page silently fail every check made across them. It has
 * cost real time twice already: mesh-api's client generator emitted `unknown` for every type when
 * zod resolved twice, and a form rendered its submit button and no fields at all, throwing nothing.
 * One instance, and it comes from the framework.
 *
 * The problem was that none of the existing entries let a browser have it:
 *
 *   `.`         pulls ServiceBroker, the Supervisor, express — `node:http` and 29 others
 *   `./node`    transports, mongodb, the database layer
 *   `./browser` named for the browser and *also* exports ServiceBroker, so it fails the same way
 *
 * Downstream that left a bad choice: import `z` from `zod` directly and give up the single-instance
 * guarantee, or import it from the mesh root and drag a server into a browser bundle. Both were
 * taken, in different files, which is how you end up with the duplicate-instance bugs above.
 *
 * ## What is in here
 *
 * Only what a contract is made of. Every module below imports nothing but `zod`, which is what
 * makes this entry safe to bundle for a browser — verified in CI, not assumed.
 *
 * Nothing that executes a contract belongs here. If something in this file ever needs the broker,
 * it is in the wrong file.
 */
import { z } from 'zod';
export { z };

export * from './interfaces/IToolContract.js';
export * from './interfaces/ICrudContract.js';
export * from './interfaces/IEventContract.js';
