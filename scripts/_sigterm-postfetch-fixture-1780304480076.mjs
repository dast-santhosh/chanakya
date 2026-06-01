
    import { runSeed } from './_seed-utils.mjs';
    let opIndex = 0;
    let postFetchReady = false;
    globalThis.fetch = async (url, opts = {}) => {
      const body = opts?.body ? (() => { try { return JSON.parse(opts.body); } catch { return opts.body; } })() : null;
      let shape = 'other';
      if (Array.isArray(body)) {
        if (Array.isArray(body[0])) {
          shape = body[0][0] === 'EXPIRE' ? 'pipeline-EXPIRE' : 'pipeline-other';
        } else if (body[0] === 'EVAL') {
          shape = 'EVAL';
        } else {
          shape = 'cmd-' + body[0];
        }
      }
      console.error('FETCH_OP idx=' + (opIndex++) + ' shape=' + shape + ' body=' + JSON.stringify(body));
      // ONLY the acquireLock op (SET key val NX PX ttl) and the SIGTERM
      // handler's releaseLock EVAL get real OKs. The lock-release path
      // must NOT hang — otherwise the handler would block on its own
      // releaseLock call and never reach process.exit(143).
      if (Array.isArray(body) && body[0] === 'SET' && body[3] === 'NX') {
        return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
      }
      if (Array.isArray(body) && body[0] === 'EVAL') {
        return new Response(JSON.stringify({ result: 1 }), { status: 200 });
      }
      // First non-lock op signals the test we've entered publish phase,
      // then hangs so SIGTERM has time to arrive. setInterval keeps the
      // event loop alive — without it Node's "unsettled top-level await"
      // detection bails before setImmediate fires.
      if (!postFetchReady) {
        postFetchReady = true;
        setInterval(() => {}, 10_000);
        setImmediate(() => console.log('PUBLISH_HUNG'));
      }
      return new Promise(() => {});  // never resolves
    };
    const quickFetch = async () => {
      // Tiny payload — atomicPublish should accept it past validate.
      return { items: [{ k: 1 }] };
    };
    await runSeed('test-domain', 'post-fetch', 'data:test:post-fetch:v1', quickFetch, {
      ttlSeconds: 900,
      lockTtlMs: 60_000,
    });
  