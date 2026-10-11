import { Greeting } from "@/components/greeting";
import items from "../data/items.json";
import { archive } from "../actions";

export default function Home() {
  return (
    <main className="p-6">
      <Greeting name="team" />
      <ul>
        {items.map((item) => (
          <li key={item.id} data-testid="item">
            {item.title}
          </li>
        ))}
      </ul>
      <img src="/logo.svg" alt="Logo" data-testid="logo" />
      <button type="button" onClick={() => void archive("w1")}>
        Archive
      </button>
    </main>
  );
}
