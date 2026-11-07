import { Card } from "../components/ui/Card";

export function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <Card title={title}>
      <p className="text-slate-500 dark:text-white/60">{text}</p>
    </Card>
  );
}
