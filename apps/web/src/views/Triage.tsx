import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  ViewHeader,
} from "../components/ui";

/**
 * 分诊：一次一张卡，像 CLI 的 kb triage 但看得到正文。
 * 入口税在两端强制：这里 use_when 为空时 L0/L1 按钮禁用；服务端同样拒绝。
 */
export default function Triage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notes", "untriaged"], queryFn: () => api.notes("untriaged") });
  const [cursor, setCursor] = useState(0);
  const [useWhen, setUseWhen] = useState("");

  const notes = q.data?.notes ?? [];
  const current = notes[cursor];

  const detail = useQuery({
    queryKey: ["note", current?.path],
    queryFn: () => api.noteDetail(current!.path),
    enabled: !!current,
  });

  const decide = useMutation({
    mutationFn: (tier: "L0" | "L1" | "inbox") =>
      api.triage([{ path: current!.path, tier, useWhen: useWhen.trim() || undefined }]),
    onSuccess: () => {
      setUseWhen("");
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      // 列表刷新后当前条消失，cursor 自然指向下一条
      setCursor((c) => Math.min(c, Math.max(0, notes.length - 2)));
    },
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;

  return (
    <div>
      <ViewHeader
        eyebrow="接诊台"
        title="分诊"
        desc="给新笔记定层。写不出「什么时候会再用到」的，只能进 inbox 等它自己证明价值。"
        right={
          notes.length > 0 && (
            <span className="font-mono text-sm text-ash">
              {Math.min(cursor + 1, notes.length)}/{notes.length}
            </span>
          )
        }
      />

      {notes.length === 0 ? (
        <Empty title="没有未分诊的笔记。代谢健康。" />
      ) : !current ? (
        <Empty title="这一批分诊完了。" />
      ) : (
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">{current.title}</h2>
              <Path className="block truncate">{current.path}</Path>
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                setUseWhen("");
                setCursor((c) => (c + 1) % notes.length);
              }}
            >
              跳过
            </Button>
          </div>

          <div className="mt-4 max-h-64 overflow-y-auto rounded border border-line bg-paper p-4 text-sm leading-relaxed text-ash">
            {detail.isLoading ? "读取中…" : detail.data?.body.slice(0, 1500) || "（空白笔记）"}
          </div>

          <div className="mt-4 space-y-3 border-t border-line pt-4">
            <Field
              label="什么时候会再用到？"
              hint="入口税：答不上来，就说明它进不了 L0/L1"
            >
              <Input
                value={useWhen}
                onChange={(e) => setUseWhen(e.target.value)}
                placeholder="如：写周报要数据时 / 下次配置 CI 时"
                autoFocus
              />
            </Field>
            {decide.error && <ErrorBox error={decide.error} />}
            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={!useWhen.trim() || decide.isPending}
                onClick={() => decide.mutate("L0")}
                title={!useWhen.trim() ? "入口税：先写出用途" : undefined}
              >
                L0 判断级
              </Button>
              <Button
                variant="alive"
                disabled={!useWhen.trim() || decide.isPending}
                onClick={() => decide.mutate("L1")}
                title={!useWhen.trim() ? "入口税：先写出用途" : undefined}
              >
                L1 资料级
              </Button>
              <Button
                variant="default"
                disabled={decide.isPending}
                onClick={() => decide.mutate("inbox")}
              >
                inbox（30 天限期）
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
