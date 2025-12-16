import config from "$config";

const mod = (await import("@asoltys/clightning-client")).default;
const { LightningClient } = mod as { LightningClient: any };

class LightningUnavailableError extends Error {
  code = "LIGHTNING_UNAVAILABLE" as const;
  constructor(msg: string) {
    super(msg);
    this.name = "LightningUnavailableError";
  }
}

function isUnavailable(e: any) {
  const code = e?.code ?? e?.errno;
  return code === "ENOENT" || code === 2 || code === "ECONNREFUSED";
}

function isSocketDied(e: any) {
  const code = e?.code ?? e?.errno;
  return code === "EPIPE" || code === "ECONNRESET" || code === "ENOENT" || code === 2;
}

function lightningProxy(rpcPath: string) {
  let client: any = null;

  let nextTryAt = 0;
  let backoff = 250;
  const maxBackoff = 5000;

  function ensure() {
    if (client) return client;

    const now = Date.now();
    if (now < nextTryAt) {
      throw new LightningUnavailableError(`Lightning not ready at ${rpcPath}`);
    }

    try {
      client = new LightningClient(rpcPath);
      backoff = 250;
      nextTryAt = 0;
      return client;
    } catch (e: any) {
      nextTryAt = Date.now() + backoff;
      backoff = Math.min(maxBackoff, Math.floor(backoff * 1.8));

      if (isUnavailable(e)) {
        throw new LightningUnavailableError(
          `Lightning RPC unavailable at ${rpcPath} (${e?.code ?? e?.errno ?? "error"})`
        );
      }
      throw e;
    }
  }

  return new Proxy(
    {},
    {
      get(_t, prop: string | symbol) {
        if (prop === "toString") return () => "[LightningProxy]";
        if (prop === Symbol.toStringTag) return "LightningProxy";

        return async (...args: any[]) => {
          const c = ensure();
          const v = c[prop as any];

          if (typeof v !== "function") return v;

          try {
            return await v.apply(c, args);
          } catch (e: any) {
            if (isSocketDied(e)) client = null;
            throw e;
          }
        };
      },
    }
  );
}

// exports preserved
const ln = lightningProxy(config.lightning);
export default ln;

export const lnb = lightningProxy(config.lightningb);
export { LightningUnavailableError };
