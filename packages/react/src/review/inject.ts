/// <reference lib="dom" />
/**
 * The review agent Mostra injects into every HTML page it serves inside an artifact other than the
 * page itself (WP-20, ARCHITECTURE §8: "Frames Mostra serves get the injected bridge"): it answers
 * the page's review agent over the nested protocol, so a comment on the frame's content anchors
 * semantically. A self-contained script, built apart from the client runtime.
 */
import { answerParent } from "./agent.ts";

answerParent();
