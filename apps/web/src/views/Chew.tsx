import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { api } from "../api";
import {
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Input,
  Loading,
  Path,
  Textarea,
  ViewHeader,
  cn,
} from "../components/ui";

/**
 * 消化：AI 是消化酶不是胃。这里没有任何自动生成——
 * 判断必须由你亲口写出，系统只负责把它和证据链一起落成 L0。
 */
export default function Chew() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["chew"], queryFn: api.chewCandidates });
  const [selected, setSelected] = useState<string | null>(null);
  const [judgment, setJudgment] = useState("");
  const [useWhen, setUseWhen] = useState("");

  const candidates = q.data?.candidates ?? [];
  const current = candidates.find((c) => c.path === selected) ?? null;

  const source = useQuery({
    queryKey: ["note", current?.path],
    queryFn: () => api.noteDetail(current!.path),
    enabled: !!current,
  });

  const chew = useMutation({
    mutationFn: () =>
      api.chew({
        judgment: judgment.trim(),
        useWhen: useWhen.trim(),
        evidencePaths: [current!.path],
      }),
    onSuccess: () => {
      setJudgment("");
      setUseWhen("");
      setSelected(null);
      qc.invalidateQueries();
    },
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;

  return (
    <div>
      <ViewHeader
        eyebrow="消化道"
        title="消化"
        desc="近 90 天被反复读取的 L1 有营养——用你自己的话，把它提炼成一句可复述的判断。"
      />

      {chew.data && (
        <div className="mb-4 rounded border border-alive/40 bg-alive-soft px-3 py-2 text-sm text-alive">
          ✅ L0 已生成：{chew.data.created}——源资料已标记 kb_digested，营养转移完毕，之后可自然衰亡。
        </div>
      )}

      {candidates.length === 0 ? (
        <Empty title="没有达到消化阈值的资料。">
          近 90 天被读 ≥2 次的 L1 才上桌。继续走门使用，营养自然浮现。
        </Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-2">
            {candidates.map((c) => (
              <button
                key={c.path}
                onClick={() => setSelected(c.path)}
                className={cn(
                  "block w-full border-b border-line px-4 py-3 text-left last:border-0 hover:bg-paper",
                  selected === c.path && "bg-paper"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-medium">{c.title}</div>
                  <span className="shrink-0 font-mono text-xs text-alive">
                    读 {c.reads90d} 次
                  </span>
                </div>
                <Path className="block truncate">{c.path}</Path>
              </button>
            ))}
          </Card>

          <div className="lg:col-span-3">
            {!current ? (
              <Empty title="选一篇资料开始消化。" />
            ) : (
              <Card className="p-5">
                <Path>{current.path}</Path>
                {current.useWhen && (
                  <p className="mt-2 rounded border border-decay/40 bg-decay-soft px-3 py-1.5 text-sm text-decay">
                    存入时说的用途：「{current.useWhen}」——现在还成立吗？
                  </p>
                )}
                <div className="prose-note mt-3 max-h-72 overflow-y-auto rounded border border-line bg-paper p-4">
                  {source.isLoading ? (
                    "读取中…"
                  ) : (
                    <ReactMarkdown>{source.data?.body ?? ""}</ReactMarkdown>
                  )}
                </div>

                <div className="mt-4 space-y-3 border-t border-line pt-4">
                  <Field label="用你的话说出要留下的判断" hint="一句话，可复述">
                    <Textarea
                      rows={2}
                      value={judgment}
                      onChange={(e) => setJudgment(e.target.value)}
                      placeholder="如：个人库规模下语义检索用 JS 全量余弦即可，不需要向量数据库"
                    />
                  </Field>
                  <Field label="什么时候会再用到？" hint="没有用途就不值得进 L0">
                    <Input value={useWhen} onChange={(e) => setUseWhen(e.target.value)} />
                  </Field>
                  {chew.error && <ErrorBox error={chew.error} />}
                  <div className="flex justify-end">
                    <Button
                      variant="primary"
                      disabled={!judgment.trim() || !useWhen.trim() || chew.isPending}
                      onClick={() => chew.mutate()}
                    >
                      {chew.isPending ? "落盘中…" : "落成 L0 判断"}
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
