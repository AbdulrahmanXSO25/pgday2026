/**
 * Compatibility alias — `server.ts` re-exports Node entry `index.ts`.
 * Keeps `tsx watch src/server.ts` working as documented in spec prompt,
 * while canonical entry is `src/index.ts` per deliverables.
 */
export * from "./index.js";
import app from "./index.js";
export default app;
