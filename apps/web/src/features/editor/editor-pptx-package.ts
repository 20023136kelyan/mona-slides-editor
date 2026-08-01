/**
 * Compatibility entry point for editor tests and lazy worker chunks.
 *
 * Package inventory belongs to the framework-free ingestion package. Keeping
 * this thin re-export avoids a flag-day import rewrite while preventing the web
 * feature tree from becoming a second implementation.
 */
export { createPowerPointPackageBacking } from '@mona/pptx-ingestion/package-backing'
