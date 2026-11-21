/**
 * Ports for the suites' own servers a browser loads from: a remote server, a page on another
 * origin, a plain page (#95). They listen where Mostra's short-lived listeners do (`addressing`'s
 * `SHORT_LIVED_FIRST_PORT` to `SHORT_LIVED_LAST_PORT`): above Mostra's lease range (20000 to
 * 32767, D99), so never a port a test home leased, and below Windows' and macOS's dynamic ranges
 * (49152 to 65535). On Windows, Chromium picks each connection's local port at random (D157), and
 * a listener on a port of the dynamic range meets a four-tuple still in TIME_WAIT from a
 * connection whose local port it was about five times as often as one outside it, which fails the
 * load with `net::ERR_NO_BUFFER_SPACE` (VERIFIED_FACTS, #95).
 */
import { randomInt } from "node:crypto";
import { createServer, type Server } from "node:net";

const FIRST = 32768;
const LAST = 49151;

/** Binds `server` to a free port of the range on `host`; resolves with the port. */
export async function listenShortLived(server: Server, host = "127.0.0.1"): Promise<number> {
  for (let attempt = 0; attempt < 64; attempt++) {
    const port = randomInt(FIRST, LAST + 1);
    const bound = await new Promise<boolean>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE" || error.code === "EACCES") resolve(false);
        else reject(error);
      };
      const onListening = (): void => {
        server.off("error", onError);
        resolve(true);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });
    if (bound) return port;
  }
  throw new Error(`No port between ${FIRST} and ${LAST} was free on ${host} after 64 tries.`);
}

/**
 * A port of the range, held by a listener of this process until `release()`: for a server another
 * process starts on it later, so nothing else takes it in between (a daemon started meanwhile
 * binds its own short-lived listeners in the same range). Release it just before that server
 * starts; releasing twice does nothing.
 */
export async function reserveShortLivedPort(): Promise<{
  readonly port: number;
  release(): Promise<void>;
}> {
  const holder = createServer();
  const port = await listenShortLived(holder);
  let released: Promise<void> | undefined;
  return {
    port,
    release: () => {
      released ??= new Promise<void>((resolve) => holder.close(() => resolve()));
      return released;
    },
  };
}
