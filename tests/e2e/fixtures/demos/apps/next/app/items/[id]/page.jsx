import Link from "next/link";
import { items } from "../../items.js";

export function generateStaticParams() {
  return items.map((item) => ({ id: String(item.id) }));
}

export default async function Item({ params }) {
  const { id } = await params;
  const item = items.find((one) => String(one.id) === id);
  return (
    <main>
      <h1 id="title">{item ? item.name : "No such item"}</h1>
      <Link id="back" href="/">
        All items
      </Link>
    </main>
  );
}
