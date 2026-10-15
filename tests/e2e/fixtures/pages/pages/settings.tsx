import { useField } from "@mostra/react";

export default function Settings() {
  const [theme, setTheme] = useField("settings.theme", "light", { label: "Theme" });
  return (
    <section>
      <h1 data-testid="page">Settings</h1>
      <input data-testid="theme" value={theme} onChange={(event) => setTheme(event.target.value)} />
    </section>
  );
}
