/**
 * Deliberately empty.
 *
 * The renderer talks to the agent host over the same loopback HTTP and WebSocket it
 * always did, so it needs nothing from the shell yet. This file exists so the window
 * has a sandboxed preload from the start: adding one later, after code has grown to
 * assume `nodeIntegration`, is the migration nobody wants.
 *
 * CommonJS on purpose - a sandboxed preload cannot be an ES module.
 */
export {}
