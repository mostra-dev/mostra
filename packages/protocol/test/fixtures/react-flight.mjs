// Runs every conformance case through React's own Flight reply codec (`encodeReply` in the client,
// `decodeReply` in the server), the path a Server Function's arguments take in React's `rsc`
// world, and prints, per case, whether React took the value and how it came back. Run with
// `node --conditions=react-server` (React's server build checks it); `serializer.test.ts` does.
import { encodeReply } from "react-server-dom-parcel/client.edge";
import { decodeReply } from "react-server-dom-parcel/server.edge";
import { CASES, describe } from "./serializer-cases.ts";

// React's development build warns on stderr about the cases it refuses or coerces; the verdicts go
// to stdout as one JSON object.
const results = {};
for (const testCase of CASES) {
  try {
    const body = await encodeReply([testCase.make()]);
    const [back] = await decodeReply(body);
    results[testCase.name] = { accepted: true, value: await describe(back) };
  } catch (error) {
    results[testCase.name] = { accepted: false, message: String(error?.message ?? error).slice(0, 200) };
  }
}
process.stdout.write(JSON.stringify(results));
