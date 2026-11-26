"use client";
import Link from "next/link";
import { useState } from "react";
import { items } from "./items.js";

export default function Page() {
  const [clicks, setClicks] = useState(0);
  return (
    <main>
      <h1 id="title" data-review-id="demo.title">
        Inventory
      </h1>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <Link id={`item-${item.id}`} href={`/items/${item.id}/`}>
              {item.name}
            </Link>
          </li>
        ))}
      </ul>
      <button id="count" type="button" onClick={() => setClicks(clicks + 1)}>
        Clicked {clicks}
      </button>
    </main>
  );
}
