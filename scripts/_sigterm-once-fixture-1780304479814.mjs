
    import { runSeed } from './_seed-utils.mjs';
    globalThis.fetch = async (url, opts = {}) => {
      const body = opts?.body ? (() => { try { return JSON.parse(opts.body); } catch { return opts.body; } })() : null;
      if (Array.isArray(body) && Array.isArray(body[0])) {
        return new Response(JSON.stringify(body.map(() => ({ result: 0 }))), { status: 200 });
      }
      return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
    };
    const foreverFetch = () => new Promise(() => { console.log('READY'); setInterval(() => {}, 10_000); });
    await runSeed('test-domain', 'sigterm-once', 'data:test:sigterm-once:v1', foreverFetch, {
      ttlSeconds: 900,
      lockTtlMs: 60_000,
    });
  