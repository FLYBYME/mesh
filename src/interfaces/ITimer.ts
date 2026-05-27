/**
 * Isomorphic Timer Handle.
 * In Node.js this is a Timeout object, in the Browser it is a number.
 */
export type TimerHandle = ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>;
