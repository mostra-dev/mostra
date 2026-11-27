// The Vite demo's router and pages (D185): history routing under the base Mostra builds it for,
// with its data shipped in the build. A deep link to an item works through the SPA fallback.
import { items } from "./items.js";

const base = import.meta.env.BASE_URL;

function route() {
  const path = location.pathname.startsWith(base) ? location.pathname.slice(base.length) : "";
  const match = /^items\/(\d+)\/?$/.exec(path);
  return match ? { page: "item", id: Number(match[1]) } : { page: "list" };
}

function link(href, text, id) {
  const a = document.createElement("a");
  a.href = `${base}${href}`;
  a.textContent = text;
  if (id) a.id = id;
  a.addEventListener("click", (event) => {
    event.preventDefault();
    history.pushState({}, "", a.href);
    render();
  });
  return a;
}

let clicks = 0;

function render() {
  const root = document.getElementById("app");
  root.replaceChildren();
  const current = route();
  if (current.page === "item") {
    const item = items.find((one) => one.id === current.id);
    const heading = document.createElement("h1");
    heading.id = "title";
    heading.dataset.reviewId = "demo.title";
    heading.textContent = item ? item.name : "No such item";
    const back = link("", "All items", "back");
    root.append(heading, back);
    return;
  }
  const heading = document.createElement("h1");
  heading.id = "title";
  heading.dataset.reviewId = "demo.title";
  heading.textContent = "Inventory";
  const list = document.createElement("ul");
  for (const item of items) {
    const entry = document.createElement("li");
    entry.append(link(`items/${item.id}`, item.name, `item-${item.id}`));
    list.append(entry);
  }
  const button = document.createElement("button");
  button.id = "count";
  button.textContent = `Clicked ${clicks}`;
  button.addEventListener("click", () => {
    clicks += 1;
    button.textContent = `Clicked ${clicks}`;
  });
  root.append(heading, list, button);
}

addEventListener("popstate", render);
render();
