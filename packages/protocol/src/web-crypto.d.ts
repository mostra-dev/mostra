// The one host API this package uses: Web Crypto's random source, present in browsers and in
// Node.js 19 and later. Declared here so the package compiles without DOM or Node types.
declare global {
  var crypto: {
    getRandomValues<T extends Uint8Array>(array: T): T;
  };
}

export {};
