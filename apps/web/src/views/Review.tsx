import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import {
  Button,
  Card,
  Empty,
  ErrorBox,
  Loading,
  Modal,
  Path,
  Stamp,
  TierBadge,
  ViewHeader,
  cn,
} from "../components/ui";

/**
 * 过堂：人的判决。y=处决 n=赦免，判完统一执行（approve + execute）。
 * 这里是全站唯一能"删"东西的地方——而且执行的是 git mv，永远可反悔。
 */

type Verdict = "execute" | "pardon" | "promote";

export default function Review() {
  const qc = useQueryClient();
  const reportsQ = useQuery({ queryKey: ["reports"], queryFn: api.reports });
  const latest = useMemo(
    () => reportsQ.data?.reports.find((r) => r.kind === "kill-list"),
    [reportsQ.data]
  );
  const detailQ = useQuery({
    queryKey: ["report", latest?.file],
    queryFn: () => api.reportDetail(latest!.file),
    enabled: !!latest,
  });

  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});
  const [confirming, setConfirming] = useState(false);
  const [promoting, setPromoting] = useState<{ line: number; path: string } | null>(null);
  const [useWhen, setUseWhen] = useState("");
  const [promoteTier, setPromoteTier] = useState<"L0" | "L1">("L1");

  const promote = useMutation({
    mutationFn: (p: { line: number; path: string }) =>
      api.promote({ path: p.path, tier: promoteTier, useWhen: useWhen.trim() }),
    onSuccess: (_r, p) => {
      setVerdicts((s) => ({ ...s, [p.line]: "promote" }));
      setPromoting(null);
      setUseWhen("");
      setPromoteTier("L1");
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    },
  });

  const digest = useMutation({
    mutationFn: api.digest,
    onSuccess: () => qc.invalidateQueries(),
  });

  const execute = useMutation({
    mutationFn: async () => {
      const lines = Object.entries(verdicts)
        .filter(([, v]) => v === "execute")
        .map(([l]) => Number(l));
      if (lines.length > 0) await api.reviewApprove(latest!.file, lines);
      return api.reviewExecute(latest!.file);
    },
    onSuccess: () => {
      setConfirming(false);
      setVerdicts({});
      qc.invalidateQueries();
    },
  });

  if (reportsQ.isLoading) return <Loading />;
  if (reportsQ.error) return <ErrorBox error={reportsQ.error} />;

  const pending = detailQ.data?.items?.filter((i) => !i.checked) ?? [];
  const alreadyApproved = detailQ.data?.items?.filter((i) => i.checked && i.exists) ?? [];
  const executeCount = Object.values(verdicts).filter((v) => v === "execute").length;
  const pardonCount = Object.values(verdicts).filter((v) => v === "pardon").length;
  const promoteCount = Object.values(verdicts).filter((v) => v === "promote").length;
  const judged = executeCount + pardonCount + promoteCount;

  return (
    <div className="pb-20">
      <ViewHeader
        eyebrow="法庭"
        title="过堂"
        desc="法医只提案，你是法官。赦免的下周仍可能上榜，除非获得使用信号。"
        right={
          latest && (
            <span className="font-mono text-xs text-faint">{latest.file}</span>
          )
        }
      />

      {execute.data && (
        <div className="mb-4 rounded border border-alive/40 bg-alive-soft px-3 py-2 text-sm text-alive">
          已掩埋 {execute.data.moved.length} 篇
          {execute.data.committed ? "，git 已提交（可反悔）" : "（未提交：无 git 或暂存区有你的东西）"}
          。<Link to="/notes" className="underline">去墓地看看</Link>
        </div>
      )}

      {!latest ? (
        <Empty title="还没有处决名单。">
          <Button onClick={() => digest.mutate()} disabled={digest.isPending}>
            {digest.isPending ? "法医验尸中…" : "跑一次消化仪式，让法医出名单"}
          </Button>
          {digest.error && <div className="mt-3"><ErrorBox error={digest.error} /></div>}
        </Empty>
      ) : detailQ.isLoading ? (
        <Loading />
      ) : detailQ.error ? (
        <ErrorBox error={detailQ.error} />
      ) : pending.length === 0 && alreadyApproved.length === 0 ? (
        <Empty title="本期名单没有候选——代谢健康。">
          <Link to="/" className="underline">回总览</Link>
        </Empty>
      ) : (
        <>
          {alreadyApproved.length > 0 && (
            <div className="mb-4 rounded border border-decay/40 bg-decay-soft px-3 py-2 text-sm text-decay">
              名单里有 {alreadyApproved.length} 条上次已勾选未执行的——执行判决时会一并掩埋。
            </div>
          )}
          <div className="space-y-3">
            {pending.map((item) => {
              const v = verdicts[item.line];
              return (
                <Card
                  key={item.line}
                  className={cn("relative p-4", v === "execute" && "border-seal/50", v === "pardon" && "border-alive/50")}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <TierBadge
                          tier={item.rest.match(/^\[([^\]]+)\]/)?.[1] ?? null}
                        />
                        <Path className="truncate">{item.path}</Path>
                        {!item.exists && (
                          <span className="text-xs text-faint">（文件已不存在）</span>
                        )}
                      </div>
                      <div className="mt-1.5 text-sm text-ash">
                        {item.rest.replace(/^\[[^\]]+\]\s*/, "")}
                      </div>
                      {item.preview && (
                        <p className="mt-2 line-clamp-2 text-sm text-faint">{item.preview}…</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {v ? (
                        <>
                          <Stamp kind={v} />
                          {v !== "promote" && (
                            <Button
                              variant="ghost"
                              className="px-2 py-1 text-xs"
                              onClick={() =>
                                setVerdicts((s) => {
                                  const next = { ...s };
                                  delete next[item.line];
                                  return next;
                                })
                              }
                            >
                              撤回
                            </Button>
                          )}
                        </>
                      ) : (
                        <>
                          <Button
                            variant="seal"
                            onClick={() => setVerdicts((s) => ({ ...s, [item.line]: "execute" }))}
                          >
                            处决
                          </Button>
                          <Button
                            variant="alive"
                            onClick={() => setVerdicts((s) => ({ ...s, [item.line]: "pardon" }))}
                          >
                            赦免
                          </Button>
                          <Button
                            onClick={() => {
                              setPromoting({ line: item.line, path: item.path });
                              setUseWhen("");
                              setPromoteTier("L1");
                            }}
                          >
                            升级
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* 判决席：粘底执行栏 */}
          <div className="fixed bottom-0 left-44 right-0 border-t border-line bg-card/95 backdrop-blur">
            <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
              <div className="font-mono text-sm text-ash">
                已判 {judged}/{pending.length} · 处决 {executeCount} · 赦免 {pardonCount} · 升级 {promoteCount}
              </div>
              <Button
                variant={executeCount > 0 ? "primary" : "default"}
                disabled={(executeCount === 0 && alreadyApproved.length === 0) || execute.isPending}
                onClick={() => setConfirming(true)}
              >
                执行判决
              </Button>
            </div>
          </div>

          <Modal open={!!promoting} onClose={() => setPromoting(null)}>
            <h2 className="text-base font-semibold">晋升这篇笔记</h2>
            <p className="mt-1 break-all font-mono text-xs text-faint">{promoting?.path}</p>
            <p className="mt-2 text-sm text-ash">
              入口税照收：写不出"什么时候会再用到"，它就不该晋升。晋升会清除 inbox 过期日。
            </p>
            <input
              autoFocus
              value={useWhen}
              onChange={(e) => setUseWhen(e.target.value)}
              placeholder="什么时候会再用到？（必填）"
              className="mt-3 w-full rounded border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-alive"
            />
            <div className="mt-3 flex items-center gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={promoteTier === "L1"}
                  onChange={() => setPromoteTier("L1")}
                />
                L1 资料
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={promoteTier === "L0"}
                  onChange={() => setPromoteTier("L0")}
                />
                L0 判断（有容量上限）
              </label>
            </div>
            {promote.error && <div className="mt-3"><ErrorBox error={promote.error} /></div>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPromoting(null)}>
                取消
              </Button>
              <Button
                variant="alive"
                disabled={!useWhen.trim() || promote.isPending}
                onClick={() => promoting && promote.mutate(promoting)}
              >
                {promote.isPending ? "晋升中…" : "确认晋升"}
              </Button>
            </div>
          </Modal>

          <Modal open={confirming} onClose={() => setConfirming(false)}>
            <h2 className="text-base font-semibold">
              掩埋 {executeCount + alreadyApproved.length} 篇笔记？
            </h2>
            <p className="mt-2 text-sm text-ash">
              git mv 到 _graveyard/ 并提交——永远可反悔（墓地里可还魂）。
              赦免的 {pardonCount} 篇保持原样。
            </p>
            {execute.error && <div className="mt-3"><ErrorBox error={execute.error} /></div>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                取消
              </Button>
              <Button variant="seal" onClick={() => execute.mutate()} disabled={execute.isPending}>
                {execute.isPending ? "掩埋中…" : "确认掩埋"}
              </Button>
            </div>
          </Modal>

        </>
      )}
    </div>
  );
}
