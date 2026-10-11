export function Greeting({ name }: { name: string }) {
  return <h2 className="text-xl font-bold text-emerald-700" data-testid="greeting">Hello, {name}</h2>;
}
