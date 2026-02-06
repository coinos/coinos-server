import ln, { LightningUnavailableError } from "$lib/ln";
import { err, l, warn } from "$lib/logging";

const HEALTH_CHECK_INTERVAL = 2 * 60 * 1000; // 2 minutes
const RPC_TIMEOUT = 30_000; // 30 seconds - fail fast if RPC hangs
const MAX_CONSECUTIVE_FAILURES = 3;

let consecutiveFailures = 0;
let lastSuccessTime = Date.now();
let lastFailureReason = "";
let checkTimer: ReturnType<typeof setTimeout> | null = null;

export function getHealthStatus() {
  return {
    consecutiveFailures,
    lastSuccessTime,
    lastFailureReason,
    healthy: consecutiveFailures < MAX_CONSECUTIVE_FAILURES,
    stalledCheck: checkTimer === null && consecutiveFailures > 0,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

async function checkLightningHealth(): Promise<boolean> {
  const startTime = Date.now();

  try {
    l("health check: testing lightning connection...");
    const info = await withTimeout(ln.getinfo(), RPC_TIMEOUT, "getinfo");

    if (!info?.id) {
      throw new Error("getinfo returned invalid response (no node id)");
    }

    const testLabel = `health_check_${Date.now()}`;
    const invoice = await withTimeout(
      ln.invoice({
        amount_msat: "1000msat",
        label: testLabel,
        description: "health check",
        expiry: 60,
      }),
      RPC_TIMEOUT,
      "invoice",
    );

    if (!invoice?.bolt11) {
      throw new Error("invoice creation returned invalid response");
    }

    try {
      await withTimeout(
        ln.delinvoice({ label: testLabel, status: "unpaid" }),
        RPC_TIMEOUT,
        "delinvoice",
      );
    } catch (e) {
      // Ignore cleanup errors
    }

    const duration = Date.now() - startTime;
    l(`health check: passed in ${duration}ms, node: ${info.id.slice(0, 16)}...`);

    return true;
  } catch (e: any) {
    const duration = Date.now() - startTime;
    const errorCode = e?.code ?? e?.errno ?? "unknown";
    const errorMsg = e?.message ?? String(e);

    err(
      `health check: FAILED after ${duration}ms`,
      `code=${errorCode}`,
      `error=${errorMsg}`,
    );

    if (e instanceof LightningUnavailableError) {
      err("health check: lightning RPC socket unavailable");
    }

    lastFailureReason = `${errorCode}: ${errorMsg}`;
    return false;
  }
}

export async function runHealthCheck() {
  checkTimer = null;

  try {
    const healthy = await checkLightningHealth();

    if (healthy) {
      if (consecutiveFailures > 0) {
        l(
          `health check: recovered after ${consecutiveFailures} consecutive failures`,
        );
      }
      consecutiveFailures = 0;
      lastSuccessTime = Date.now();
      lastFailureReason = "";
    } else {
      consecutiveFailures++;
      warn(
        `health check: failure ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}`,
      );

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        err(
          `health check: ${MAX_CONSECUTIVE_FAILURES} consecutive failures, ` +
            `last success was ${Math.round((Date.now() - lastSuccessTime) / 1000)}s ago`,
        );
        err(`health check: last failure reason: ${lastFailureReason}`);
        err("health check: exiting process to trigger container restart");

        setTimeout(() => {
          process.exit(1);
        }, 1000);
        return;
      }
    }
  } catch (e: any) {
    err("health check: unexpected error during health check", e?.message);
    consecutiveFailures++;
  }

  // Schedule next check
  checkTimer = setTimeout(runHealthCheck, HEALTH_CHECK_INTERVAL);
}

export function startHealthCheck() {
  l(
    `health check: starting (interval=${HEALTH_CHECK_INTERVAL / 1000}s, timeout=${RPC_TIMEOUT / 1000}s, max_failures=${MAX_CONSECUTIVE_FAILURES})`,
  );
  // Run first check after a delay to let the app initialize
  checkTimer = setTimeout(runHealthCheck, 30000);
}
