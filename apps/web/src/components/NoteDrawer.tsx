import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { api } from "../api";
import { agoText, fmtTime } from "../format";
import { tSignal } from "../i18n";
import { ErrorBox, Loading, Path, TierBadge, cn } from "./ui";

/**
 * 笔记详情抽屉。打开即产生一条 kb_ui 观察信号（服务端记账）——
 * 法医不认，不给笔记续命；这行小字印在抽屉底部，提醒你界面不是门。
 */
export function NoteDrawer({ path, onClose }: { path: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["note", path], queryFn: () => api.noteDetail(path) });

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/20" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-full w-full max-w-xl flex-col border-l border-line bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {q.isLoading && <Loading />}
        {q.error && (
          <div className="p-4">
            <ErrorBox error={q.error} />
          </div>
        )}
        {q.data && (
          <>
            <div className="border-b border-line px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <TierBadge tier={(q.data.frontmatter.kb_tier as string) ?? null} />
                    <h2 className="text-base font-semibold">{q.data.title}</h2>
                  </div>
                  <Path className="mt-1 block">{q.data.path}</Path>
                </div>
                <button
                  onClick={onClose}
                  aria-label="关闭"
                  className="rounded px-2 py-1 text-ash hover:bg-paper hover:text-ink"
                >
                  ✕
                </button>
              </div>
              {typeof q.data.frontmatter.kb_use_when === "string" && (
                <p className="mt-2 text-sm text-ash">
                  <span className="text-faint">何时再用：</span>
                  {q.data.frontmatter.kb_use_when}
                </p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="prose-note">
                <ReactMarkdown>{q.data.body}</ReactMarkdown>
              </div>

              {q.data.backlinks.length > 0 && (
                <section className="mt-6 border-t border-line pt-4">
                  <h3 className="mb-2 text-xs font-medium tracking-wide text-ash">
                    反向链接（{q.data.backlinks.length}）
                  </h3>
                  <ul className="space-y-1">
                    {q.data.backlinks.map((b) => (
                      <li key={b}>
                        <Path>{b}</Path>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="mt-6 border-t border-line pt-4">
                <h3 className="mb-2 text-xs font-medium tracking-wide text-ash">
                  信号史（最近 {q.data.signals.length} 条）
                </h3>
                {q.data.signals.length === 0 ? (
                  <p className="text-sm text-faint">这篇笔记从未走过门——法医眼里它正在死去。</p>
                ) : (
                  <ul className="space-y-1 font-mono text-xs">
                    {q.data.signals.map((s, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="text-faint">{fmtTime(s.ts)}</span>
                        <span
                          className={cn(
                            s.tool === "kb_cite"
                              ? "text-alive font-semibold"
                              : s.tool === "kb_read"
                                ? "text-alive"
                                : "text-ash"
                          )}
                        >
                          {tSignal(s.tool)}
                        </span>
                        <span className="text-faint">{agoText(s.ts)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <div className="border-t border-line px-5 py-2 text-xs text-faint">
              此次浏览已记 kb_ui 观察信号——不给笔记续命。想让它活下去，去用它。
            </div>
          </>
        )}
      </div>
    </div>
  );
}
