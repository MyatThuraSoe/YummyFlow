import { initEdgeStore } from "@edgestore/server";
import { createEdgeStoreExpressHandler } from "@edgestore/server/adapters/express";

// --- EDGESTORE ROUTER CONFIG ---=> move to new file
const es = initEdgeStore.create();
const edgeStoreRouter = es.router({
  // The `console.log` that used to sit here dumped the full EdgeStore request
  // context and file metadata to stdout on every delete. The route is now
  // authenticated, but a delete is still a delete: log the file name and
  // nothing else.
  publicFiles: es.fileBucket().beforeDelete(({ fileInfo }) => {
    // `fileInfo` exposes `url`, not `name` — logging `ctx` (the whole request)
    // is what this replaced, and it dumped internal request detail on every
    // delete. The url is enough to identify which object was removed.
    console.log("[edgestore] file delete requested:", fileInfo.url);
    return true; // allow delete
  }),
});

export type EdgeStoreRouter = typeof edgeStoreRouter;

const handler = createEdgeStoreExpressHandler({
  router: edgeStoreRouter,
});

export { handler as edgestoreHandler };
