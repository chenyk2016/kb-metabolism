import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import {
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  Loading,
  Modal,
  ViewHeader,
  cn,
} from "../components/ui";

/**
 * 设置 = config.json 的白名单表单。secrets 永不出现在这里——
 * key 的配置只有一条路：终端里 kb key set（0600 + gitignore）。
 */

type FormState = {
  managed: string;
  exclude: string;
  captureDir: string;
  l0Cap: string;
  inboxDays: string;
  decayDays: string;
  citeDays: string;
  outputDirs: string;
  provider: "human" | "anthropic" | "agent";
  triageModel: string;
  digestModel: string;
  embeddingOn: boolean;
  embeddingBaseUrl: string;
  embeddingModel: string;
};

function ReportsSection() {
  const q = useQuery({ queryKey: ["reports"], queryFn: api.reports });
  const [viewing, setViewing] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["report", viewing],
    queryFn: () => api.reportDetail(viewing!),
    enabled: !!viewing,
  });
  const kindLabel = { "kill-list": "处决名单", health: "体检", "chew-list": "消化名单", other: "报告" };

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">报告历史</h2>
      <p className="mt-1 text-xs text-ash">.kb/reports/——法医名单、体检、消化名单的留档。</p>
      {q.data && q.data.reports.length === 0 && (
        <p className="mt-3 text-sm text-faint">还没有报告。跑一次消化仪式就有了。</p>
      )}
      <ul className="mt-3 space-y-1">
        {q.data?.reports.map((r) => (
          <li key={r.file}>
            <button
              className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left text-sm hover:bg-paper"
              onClick={() => setViewing(r.file)}
            >
              <span
                className={cn(
                  "w-16 shrink-0 rounded border px-1.5 py-0.5 text-center text-xs",
                  r.kind === "kill-list"
                    ? "border-seal/40 text-seal"
                    : r.kind === "health"
                      ? "border-alive/40 text-alive"
                      : "border-line text-ash"
                )}
              >
                {kindLabel[r.kind]}
              </span>
              <span className="font-mono text-xs text-ash">{r.file}</span>
              {r.kind === "kill-list" && (
                <span className="font-mono text-xs text-faint">
                  待审 {r.pending} · 已勾 {r.approved}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <Modal open={!!viewing} onClose={() => setViewing(null)} wide>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-mono text-sm">{viewing}</h3>
          <Button variant="ghost" onClick={() => setViewing(null)}>
            关闭
          </Button>
        </div>
        <pre className="overflow-x-auto rounded border border-line bg-paper p-4 text-xs leading-relaxed whitespace-pre-wrap">
          {detail.data?.content ?? "读取中…"}
        </pre>
      </Modal>
    </Card>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["config"], queryFn: api.config });
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (q.data && !form) {
      const c = q.data.config;
      setForm({
        managed: c.managed.join("\n"),
        exclude: c.exclude.join("\n"),
        captureDir: c.captureDir,
        l0Cap: String(c.l0Cap),
        inboxDays: String(c.inboxDays),
        decayDays: String(c.decayDays),
        citeDays: String(c.citeDays ?? 180),
        outputDirs: (c.outputDirs ?? []).join("\n"),
        provider: c.judgment.provider,
        triageModel: c.judgment.triageModel,
        digestModel: c.judgment.digestModel,
        embeddingOn: !!c.embedding,
        embeddingBaseUrl: c.embedding?.baseUrl ?? "https://api.siliconflow.cn/v1",
        embeddingModel: c.embedding?.model ?? "BAAI/bge-m3",
      });
    }
  }, [q.data, form]);

  const save = useMutation({
    mutationFn: (f: FormState) =>
      api.saveConfig({
        managed: f.managed.split("\n").map((s) => s.trim()).filter(Boolean),
        exclude: f.exclude.split("\n").map((s) => s.trim()).filter(Boolean),
        captureDir: f.captureDir.trim() || ".",
        l0Cap: Number(f.l0Cap) || 100,
        inboxDays: Number(f.inboxDays) || 30,
        decayDays: Number(f.decayDays) || 90,
        citeDays: Number(f.citeDays) || 180,
        outputDirs: f.outputDirs.split("\n").map((s) => s.trim()).filter(Boolean),
        judgment: {
          provider: f.provider,
          triageModel: f.triageModel.trim(),
          digestModel: f.digestModel.trim(),
        },
        embedding: f.embeddingOn
          ? { baseUrl: f.embeddingBaseUrl.trim(), model: f.embeddingModel.trim() }
          : null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["config"] }),
  });

  const rebuild = useMutation({ mutationFn: api.rebuildIndex });

  if (q.isLoading || !form) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f!, ...patch }));
  const ta = "font-mono text-xs";

  return (
    <div className="space-y-5">
      <ViewHeader
        eyebrow="档案室"
        title="设置"
        desc={`${q.data!.root} · 协议 v${q.data!.version}`}
        right={
          <Button variant="primary" onClick={() => save.mutate(form)} disabled={save.isPending}>
            {save.isPending ? "保存中…" : "保存配置"}
          </Button>
        }
      />

      {save.error && <ErrorBox error={save.error} />}
      {save.isSuccess && (
        <div className="rounded border border-alive/40 bg-alive-soft px-3 py-2 text-sm text-alive">
          已写入 .kb/config.json——立即生效。
        </div>
      )}

      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="管理范围 managed" hint="每行一个 glob；收窄 ≠ exclude，不纳管的目录引用仍算反链">
          <textarea
            rows={3}
            className={cn("w-full rounded border border-line bg-card px-2.5 py-1.5", ta)}
            value={form.managed}
            onChange={(e) => set({ managed: e.target.value })}
          />
        </Field>
        <Field label="排除 exclude" hint="被排除的连反链扫描都跳过">
          <textarea
            rows={3}
            className={cn("w-full rounded border border-line bg-card px-2.5 py-1.5", ta)}
            value={form.exclude}
            onChange={(e) => set({ exclude: e.target.value })}
          />
        </Field>
        <Field label="捕捉目录 captureDir">
          <Input value={form.captureDir} onChange={(e) => set({ captureDir: e.target.value })} />
        </Field>
        <Field label="创作目录 outputDirs" hint="每行一个；其中的引用是铁证级吸收">
          <textarea
            rows={2}
            className={cn("w-full rounded border border-line bg-card px-2.5 py-1.5", ta)}
            value={form.outputDirs}
            onChange={(e) => set({ outputDirs: e.target.value })}
          />
        </Field>
      </Card>

      <Card className="grid gap-4 p-5 sm:grid-cols-4">
        <Field label="L0 硬上限">
          <Input value={form.l0Cap} onChange={(e) => set({ l0Cap: e.target.value })} />
        </Field>
        <Field label="inbox 限期（天）">
          <Input value={form.inboxDays} onChange={(e) => set({ inboxDays: e.target.value })} />
        </Field>
        <Field label="读取免死窗口（天）">
          <Input value={form.decayDays} onChange={(e) => set({ decayDays: e.target.value })} />
        </Field>
        <Field label="引用免死窗口（天）">
          <Input value={form.citeDays} onChange={(e) => set({ citeDays: e.target.value })} />
        </Field>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold">判断力 provider</h2>
        <p className="mt-1 text-xs text-ash">
          判断力是插件：human 零依赖完整可用；anthropic 用便宜模型分诊、顶级模型消化；agent 输出提示词给接入的 agent。
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <Field label="provider">
            <select
              className="w-full rounded border border-line bg-card px-2.5 py-1.5 text-sm"
              value={form.provider}
              onChange={(e) => set({ provider: e.target.value as FormState["provider"] })}
            >
              <option value="human">human（默认，零依赖）</option>
              <option value="anthropic">anthropic（需 API key）</option>
              <option value="agent">agent（输出提示词）</option>
            </select>
          </Field>
          <Field label="分诊模型" hint="高频低价值判断">
            <Input value={form.triageModel} onChange={(e) => set({ triageModel: e.target.value })} />
          </Field>
          <Field label="消化模型" hint="值得用顶级模型">
            <Input value={form.digestModel} onChange={(e) => set({ digestModel: e.target.value })} />
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">语义检索</h2>
            <p className="mt-1 text-xs text-ash">
              跨越词汇鸿沟（搜「电话」找到「手机号」）。不配置或不可用时自动降级纯字面，检索永远可用。
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.embeddingOn}
              onChange={(e) => set({ embeddingOn: e.target.checked })}
            />
            启用
          </label>
        </div>
        {form.embeddingOn && (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="服务地址" hint="任何 OpenAI 兼容端点">
              <Input
                value={form.embeddingBaseUrl}
                onChange={(e) => set({ embeddingBaseUrl: e.target.value })}
              />
            </Field>
            <Field label="模型" hint="换模型需全量重嵌">
              <Input
                value={form.embeddingModel}
                onChange={(e) => set({ embeddingModel: e.target.value })}
              />
            </Field>
            <div className="sm:col-span-2 rounded border border-line bg-paper px-3 py-2 text-xs text-ash">
              API key {q.data!.embeddingKeyConfigured ? "已配置 ✓" : "未配置"}——key
              永不经过界面，只有一条路：终端里 <code className="font-mono">kb key set</code>
              （写入 .kb/secrets.json，0600，自动 gitignore）。
            </div>
          </div>
        )}
      </Card>

      <Card className="flex items-center justify-between p-5">
        <div>
          <h2 className="text-sm font-semibold">派生索引</h2>
          <p className="mt-1 text-xs text-ash">
            SQLite 里的一切可丢弃重建；直接改过文件后跑一次让界面变新鲜。
          </p>
          {rebuild.data && (
            <p className="mt-1 font-mono text-xs text-alive">
              完成：{rebuild.data.notes} 条笔记 · {rebuild.data.links} 条反链
              {rebuild.data.embedded > 0 && ` · 增量向量 ${rebuild.data.embedded}`}
            </p>
          )}
        </div>
        <Button onClick={() => rebuild.mutate()} disabled={rebuild.isPending}>
          {rebuild.isPending ? "重建中…" : "重建索引"}
        </Button>
      </Card>

      <ReportsSection />
    </div>
  );
}
