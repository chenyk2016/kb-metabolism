import { NavLink, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import Overview from "./views/Overview";
import Notes from "./views/Notes";
import Review from "./views/Review";
import Triage from "./views/Triage";
import Chew from "./views/Chew";
import Signals from "./views/Signals";
import Settings from "./views/Settings";
import { cn } from "./components/ui";
import { t } from "./i18n";

/**
 * 左栏按人的三种角色分组——看（观察不干预）、判（人不可替代的动作）、管（系统本身）。
 * 分组即协议：AI 提案，人判决，其余自动。
 */
const NAV = [
  {
    group: t("nav.watch"),
    items: [
      { to: "/", label: t("nav.overview") },
      { to: "/notes", label: t("nav.notes") },
      { to: "/signals", label: t("nav.signals") },
    ],
  },
  {
    group: t("nav.judge"),
    items: [
      { to: "/review", label: t("nav.review"), badge: "pendingReview" as const },
      { to: "/triage", label: t("nav.triage"), badge: "untriaged" as const },
      { to: "/chew", label: t("nav.chew"), badge: "chewCandidates" as const },
    ],
  },
  {
    group: t("nav.manage"),
    items: [{ to: "/settings", label: t("nav.settings") }],
  },
];

export default function App() {
  const overview = useQuery({
    queryKey: ["overview"],
    queryFn: api.overview,
    staleTime: 30_000,
  });
  const todo = overview.data?.todo;

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 flex w-44 flex-col border-r border-line bg-card">
        <div className="border-b border-line px-4 py-4">
          <div className="text-sm font-semibold tracking-wide">kb-metabolism</div>
          <div className="mt-0.5 font-mono text-[11px] text-faint">判决台 · 体检室</div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV.map((g) => (
            <div key={g.group} className="mb-4">
              <div className="px-2 pb-1 font-mono text-[11px] tracking-[0.3em] text-faint">
                {g.group}
              </div>
              {g.items.map((item) => {
                const count = "badge" in item && item.badge && todo ? todo[item.badge] : 0;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center justify-between rounded px-2 py-1.5 text-sm",
                        isActive
                          ? "bg-paper font-medium text-ink shadow-[inset_2px_0_0_var(--color-ink)]"
                          : "text-ash hover:bg-paper hover:text-ink"
                      )
                    }
                  >
                    <span>{item.label}</span>
                    {count > 0 && (
                      <span className="rounded-full bg-seal-soft px-1.5 font-mono text-[11px] text-seal">
                        {count}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-faint">
          文件是唯一真相。
          <br />
          AI 提案，人判决。
        </div>
      </aside>

      <main className="ml-44 min-w-0 flex-1 px-8 py-6">
        <div className="mx-auto max-w-4xl">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/notes" element={<Notes />} />
            <Route path="/signals" element={<Signals />} />
            <Route path="/review" element={<Review />} />
            <Route path="/triage" element={<Triage />} />
            <Route path="/chew" element={<Chew />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
