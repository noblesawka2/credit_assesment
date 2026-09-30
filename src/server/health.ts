export function backendHealth(probe: () => Promise<unknown>, timeoutMillis = 2000, cacheMillis = 5000) {
  let cached = false;
  let expiresAt = 0;
  let pending: Promise<boolean> | undefined;
  let probing = false;
  return async (): Promise<boolean> => {
    if (Date.now() < expiresAt) return cached;
    if (pending) return pending;
    if (probing) return false;
    probing = true;
    pending = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const work = Promise.resolve().then(probe).then(() => true, () => false).finally(() => { probing = false; });
      try {
        cached = await Promise.race([work, new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), timeoutMillis); })]);
        expiresAt = Date.now() + cacheMillis;
        return cached;
      } finally { clearTimeout(timer); pending = undefined; }
    })();
    return pending;
  };
}
