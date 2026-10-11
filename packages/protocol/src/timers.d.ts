// The timer functions the JSON-RPC peer uses for request timeouts, present in browsers, workers and
// Node.js. Declared here so the package compiles without DOM or Node types.
declare global {
  function setTimeout(callback: () => void, ms?: number): unknown;
  function clearTimeout(handle: unknown): void;
}

export {};
