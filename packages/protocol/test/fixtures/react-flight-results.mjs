// Runs every conformance case through React's own Flight *server* path, the one a Server
// Function's result takes in React's `rsc` world (`renderToReadableStream` on the server,
// `createFromReadableStream` in the client), and prints, per case, whether React took the value
// and how it came back. Run with `node --conditions=react-server`, as `react-flight.mjs` is.
import { createFromReadableStream } from "react-server-dom-parcel/client.edge";
import { renderToReadableStream } from "react-server-dom-parcel/server.edge";
import { CASES, describe } from "./serializer-cases.ts";

const MANIFEST = { serverConsumerManifest: { moduleMap: {}, serverModuleMap: null, moduleLoading: null } };

const results = {};
for (const testCase of CASES) {
  try {
    let failure;
    const stream = renderToReadableStream([testCase.make()], {}, {
      onError: (error) => {
        failure = error;
      },
    });
    const [back] = await createFromReadableStream(stream, MANIFEST);
    const value = await describe(back);
    results[testCase.name] = failure
      ? { accepted: false, message: String(failure?.message ?? failure).slice(0, 200) }
      : { accepted: true, value };
  } catch (error) {
    results[testCase.name] = { accepted: false, message: String(error?.message ?? error).slice(0, 200) };
  }
}
process.stdout.write(JSON.stringify(results));
