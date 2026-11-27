// The hash-routed demo (D185 item 7): it moves between its pages by the URL's fragment, so it works
// fully from disk too.
import { items } from "./items.js";

function render() {
  const root = document.getElementById("app");
  root.replaceChildren();
  const match = /^#\/items\/(\d+)$/.exec(location.hash);
  const heading = document.createElement("h1");
  heading.id = "title";
  if (match) {
    const item = items.find((one) => one.id === Number(match[1]));
    heading.textContent = item ? item.name : "No such item";
    const back = document.createElement("a");
    back.href = "#/";
    back.id = "back";
    back.textContent = "All items";
    root.append(heading, back);
    return;
  }
  heading.textContent = "Inventory";
  const list = document.createElement("ul");
  for (const item of items) {
    const entry = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#/items/${item.id}`;
    a.id = `item-${item.id}`;
    a.textContent = item.name;
    entry.append(a);
    list.append(entry);
  }
  root.append(heading, list);
}

addEventListener("hashchange", render);
render();

// The page's values arrive by `postMessage` (D185 item 5), the first with the demo's own channel to
// its page (`event.ports[0]`), on which it answers; `parent.postMessage` reaches the page too, but
// in Safari as the page's own message. Kept outside the routed part, so they stay as the demo moves.
const greeting = document.createElement("p");
greeting.id = "greeting";
let channel;
const tell = document.createElement("button");
tell.id = "tell";
tell.type = "button";
tell.textContent = "Tell the page";
tell.addEventListener("click", () => channel?.postMessage({ "demo/told": "walnut" }));
const tellParent = document.createElement("button");
tellParent.id = "tell-parent";
tellParent.type = "button";
tellParent.textContent = "Tell the page's window";
tellParent.addEventListener("click", () => parent.postMessage({ "demo/told": "oak" }, "*"));
document.body.append(greeting, tell, tellParent);
addEventListener("message", (event) => {
  // Only the page around it: its own origin live, an opaque one (`null`, or WebKit's `file://`) from
  // disk or inside one file. (Not `event.source`: WebKit names the receiver for a same-origin
  // module script's message.)
  const page = [location.origin, "null", "file://"];
  if (!page.includes(event.origin)) return;
  const values = event.data?.["mostra/demo.values"];
  if (event.ports[0]) channel = event.ports[0];
  if (values) greeting.textContent = values.greeting;
});
