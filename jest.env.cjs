// Loads test environment before any suite runs.
//
// mesh's suites need a real MongoDB, and 78 of them failed with "MONGODB_URI environment variable
// or mongoUri must be configured" purely because nothing ever set it -- `npm test` looked like 78
// broken tests when it was one missing variable. `paas` already solves this the same way, by
// loading .env from its vitest config; jest has no such default, so it is done explicitly here.
//
// The fallback matters as much as the .env: a fresh clone with no .env should still run the suite
// against a local Mongo rather than reporting mass failure, because "unconfigured" and "broken"
// looking identical is what wasted the time in the first place.
require('dotenv').config();

if (!process.env.MONGODB_URI) {
    process.env.MONGODB_URI = 'mongodb://localhost:27017/mesh_test';
}
