import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Card, Empty, ErrorBox, Loading, Path, ViewHeader, cn } from "../components/ui";
import { fmtTime } from "../format";
import { tSignal } from "../i18n";

const LIFE_EXTENDING = new Set(["kb_read", "kb_cite"]);

/** 信号流水：唯一不可再生的数据，法医的全部证据来源。 */
export default function Signals() {
  const [tool, setTool] = useState<string>("");
  const q = useQuery({
    queryKey: ["signals", tool],
    queryFn: () => api.signals(tool || undefined),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { signals = [], tools = [] } = q.data ?? {};

  return (
    <div>
      <ViewHeader
        eyebrow="心电图"
        title="信号"
        desc="access.log.jsonl——唯一不可再生的数据。读取续命 90 天，引用续命 180 天，注入与界面浏览不续命。"
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <button
          onClick={() => setTool("")}
          className={cn(
            "rounded border px-2.5 py-1 font-mono text-xs",
            tool === "" ? "border-ink bg-ink text-card" : "border-line bg-card text-ash"
          )}
        >
          全部
        </button>
        {tools.map((tl) => (
          <button
            key={tl}
            onClick={() => setTool(tl)}
            className={cn(
              "rounded border px-2.5 py-1 font-mono text-xs",
              tool === tl ? "border-ink bg-ink text-card" : "border-line bg-card text-ash"
            )}
          >
            {tl}
          </button>
        ))}
      </div>

      {signals.length === 0 ? (
        <Empty title="还没有信号。">
          从现在起检索走门（kb_search / kb_read），90 天后法医就有读取证据可用。
        </Empty>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <tbody>
              {signals.map((s, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="w-40 px-4 py-2 font-mono text-xs text-faint">{fmtTime(s.ts)}</td>
                  <td className="w-36 px-2 py-2">
                    <span
                      className={cn(
                        "font-mono text-xs",
                        LIFE_EXTENDING.has(s.tool) ? "text-alive" : "text-ash"
                      )}
                    >
                      {tSignal(s.tool)}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    {s.path ? (
                      <Path>{s.path}</Path>
                    ) : (
                      <span className="text-xs text-ash">「{s.query}」</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
