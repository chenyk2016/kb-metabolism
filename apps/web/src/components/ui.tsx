import type { ButtonHTMLAttributes, ReactNode } from "react";
import { t } from "../i18n";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ── 按钮 ──────────────────────────────────────────────

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "seal" | "alive" | "ghost";
};

export function Button({ variant = "default", className, ...props }: ButtonProps) {
  const styles = {
    default: "border border-line bg-card hover:bg-paper text-ink",
    primary: "border border-ink bg-ink text-card hover:opacity-85",
    seal: "border border-seal text-seal bg-card hover:bg-seal-soft",
    alive: "border border-alive text-alive bg-card hover:bg-alive-soft",
    ghost: "border border-transparent text-ash hover:text-ink hover:bg-paper",
  }[variant];
  return (
    <button
      className={cn(
        "rounded px-3 py-1.5 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        styles,
        className
      )}
      {...props}
    />
  );
}

// ── 卡片 / 区块 ───────────────────────────────────────

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-lg border border-line bg-card", className)}>{children}</div>
  );
}

/** 视图头：眉题（角色）+ 标题 + 一句话职责 */
export function ViewHeader({
  eyebrow,
  title,
  desc,
  right,
}: {
  eyebrow: string;
  title: string;
  desc: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <div className="font-mono text-xs tracking-widest text-faint">{eyebrow}</div>
        <h1 className="mt-1 text-xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-ash">{desc}</p>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

// ── 层级徽章 ──────────────────────────────────────────

export function TierBadge({ tier }: { tier: string | null }) {
  const cfg =
    tier === "L0"
      ? { label: "L0", cls: "border-ink text-ink bg-card font-semibold" }
      : tier === "L1"
        ? { label: "L1", cls: "border-alive/50 text-alive bg-alive-soft" }
        : tier === "inbox"
          ? { label: "inbox", cls: "border-decay/50 text-decay bg-decay-soft" }
          : { label: t("tier.untriaged"), cls: "border-line text-ash bg-paper" };
  return (
    <span
      className={cn("inline-block rounded border px-1.5 py-0.5 font-mono text-xs", cfg.cls)}
    >
      {cfg.label}
    </span>
  );
}

// ── 生命线：一条 3px 的代谢仪表 ───────────────────────

export function VitalityBar({ value }: { value: number }) {
  const color = value > 0.5 ? "bg-alive" : value > 0.15 ? "bg-decay" : "bg-seal";
  return (
    <div
      className="h-[3px] w-16 rounded-full bg-line"
      role="meter"
      aria-valuenow={Math.round(value * 100)}
      aria-label="生命体征"
    >
      <div
        className={cn("h-full rounded-full", color)}
        style={{ width: `${Math.max(4, value * 100)}%` }}
      />
    </div>
  );
}

// ── 印章：判决的落款 ──────────────────────────────────

export function Stamp({ kind }: { kind: "execute" | "pardon" }) {
  return (
    <span
      className={cn(
        "stamp stamp-in text-lg",
        kind === "execute" ? "text-seal" : "text-alive"
      )}
    >
      {kind === "execute" ? t("action.execute") : t("action.pardon")}
    </span>
  );
}

// ── 弹层（确认对话框 / 详情） ─────────────────────────

export function Modal({
  open,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "max-h-[85vh] w-full overflow-y-auto rounded-lg border border-line bg-card p-5 shadow-xl",
          wide ? "max-w-3xl" : "max-w-md"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// ── 表单元素 ──────────────────────────────────────────

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded border border-line bg-card px-2.5 py-1.5 text-sm placeholder:text-faint",
        props.className
      )}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full rounded border border-line bg-card px-2.5 py-1.5 text-sm placeholder:text-faint",
        props.className
      )}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-ash">
        {label}
        {hint && <span className="ml-2 font-normal text-faint">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

// ── 空态 / 错误 / 加载 ────────────────────────────────

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card className="p-10 text-center">
      <div className="text-base font-medium text-ash">{title}</div>
      {children && <div className="mt-3 text-sm text-faint">{children}</div>}
    </Card>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="rounded border border-seal/40 bg-seal-soft px-3 py-2 text-sm text-seal">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function Loading() {
  return <div className="p-8 text-center text-sm text-faint">读取中…</div>;
}

// ── 路径（等宽 + 截断） ───────────────────────────────

export function Path({ children, className }: { children: string; className?: string }) {
  return (
    <span className={cn("font-mono text-xs text-ash", className)} title={children}>
      {children}
    </span>
  );
}
