/**
 * Compatibility export for the Vue reference application.
 *
 * The persisted presentation schema is owned by the framework-neutral core.
 * Keeping this module path stable lets the Vue renderer remain the visual
 * oracle while its callers migrate incrementally.
 */
export * from '@mona/presentation-core/model'
