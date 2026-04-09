import { cva } from "class-variance-authority";

const badgeStyles = cva("inline-flex rounded-full px-2.5 py-1 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "bg-slate-100 text-slate-700",
      success: "bg-emerald-100 text-emerald-700",
      warning: "bg-amber-100 text-amber-700"
    }
  },
  defaultVariants: {
    tone: "neutral"
  }
});

export function PermissionBadge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "success" | "warning" }) {
  return <span className={badgeStyles({ tone })}>{label}</span>;
}
