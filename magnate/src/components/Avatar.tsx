import type { Employee } from "@/lib/types";

export function Avatar({
  employee,
  size = 40,
  ring = false,
}: {
  employee: Employee;
  size?: number;
  ring?: boolean;
}) {
  const [from, to] = employee.accent;
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-xl font-semibold text-white ${
        ring ? "ring-2 ring-white/15" : ""
      }`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, ${from}, ${to})`,
        boxShadow: `0 6px 18px -8px ${to}`,
      }}
      aria-hidden="true"
    >
      {employee.monogram}
    </span>
  );
}
