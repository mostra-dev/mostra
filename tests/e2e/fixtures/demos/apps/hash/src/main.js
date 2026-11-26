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
