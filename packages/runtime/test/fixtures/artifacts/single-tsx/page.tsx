// AU-01: an ordinary React page with no Mostra construct at all: no manifest, no Mostra import.
import { useState } from "react";

const options = ["Compact", "Comfortable", "Spacious"];

export default function SidebarOptions() {
  const [chosen, setChosen] = useState(options[0]);
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold text-blue-600">Sidebar density</h1>
      <ul>
        {options.map((option) => (
          <li key={option}>
            <button type="button" onClick={() => setChosen(option)}>
              {option}
            </button>
          </li>
        ))}
      </ul>
      <p data-testid="chosen">Chosen: {chosen}</p>
    </main>
  );
}
