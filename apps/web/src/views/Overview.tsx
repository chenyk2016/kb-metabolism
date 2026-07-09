import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Button, Card, Empty, ErrorBox, Loading, ViewHeader, cn } from "../components/ui";

/** 代谢带：整库的年龄分层压成一条仪表——签名元素，全站唯一一处大面积色块 */
function MetabolismStrip({
  active,
  decaying,
  dormant,
}: {
  active: number;
  decaying: number;
  dormant: number;
}) {
  const total = Math.max(1, active + decaying + dormant);
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <div>
      <div className="flex h-5 overflow-hidden rounded" role="img" aria-label="库龄分层">
        <div className="bg-alive" style={{ width: seg(active) }} />
        <div className="bg-decay" style={{ width: seg(decaying) }} />
        <div className="bg-faint" style={{ width: seg(dormant) }} />
      </div>
      <div className="mt-2 flex gap-5 font-mono text-xs text-ash">
        <span>
          <i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-alive" />
          活跃/被引用 {active}
        </span>
        <span>
          <i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-decay" />
          衰退&gt;90天 {decaying}
        </span>
        <span>
          <i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-faint" />
          沉睡&gt;1年 {dormant}
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-ash">{label}</div>
      <div className="mt-0.5 font-mono text-lg font-semibold">{value}</div>
      {sub && <div className="text-xs text-faint">{sub}</div>}
    </div>
  );
}

function TodoCard({
  to,
  count,
  title,
  desc,
}: {
  to: string;
  count: number;
  title: string;
  desc: string;
}) {
  return (
    <Link to={to} className="block">
      <Card
        className={cn(
          "h-full p-4 transition-colors hover:border-ink",
          count === 0 && "opacity-50"
        )}
      >
        <div className="font-mono text-2xl font-semibold">{count}</div>
        <div className="mt-1 text-sm font-medium">{title}</div>
        <div className="mt-1 text-xs text-ash">{desc}</div>
      </Card>
    </Link>
  );
}

export default function Overview() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["overview"], queryFn: api.overview });
  const digest = useMutation({
    mutationFn: api.digest,
    onSuccess: () => qc.invalidateQueries(),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return null;

  const { doctor: d, stats, reminder, todo } = q.data;
  const absorbed = d.cited30d + d.outputRefs;
  const nothingTodo =
    todo.untriaged === 0 && todo.pendingReview === 0 && todo.chewCandidates === 0 && !reminder;

  return (
    <div>
      <ViewHeader
        eyebrow="体检室"
        title="总览"
        desc="库的代谢状况，与此刻该做的事。"
        right={
          <Button onClick={() => digest.mutate()} disabled={digest.isPending}>
            {digest.isPending ? "法医验尸中…" : "跑一次消化仪式"}
          </Button>
        }
      />

      {reminder && (
        <div className="mb-4 rounded border border-decay/40 bg-decay-soft px-3 py-2 text-sm text-decay">
          {reminder}
        </div>
      )}
      {digest.error && <div className="mb-4"><ErrorBox error={digest.error} /></div>}
      {digest.data && (
        <div className="mb-4 rounded border border-alive/40 bg-alive-soft px-3 py-2 text-sm text-alive">
          法医已出名单：{digest.data.candidates.length} 条候选（{digest.data.report}）
          {digest.data.candidates.length > 0 && (
            <>
              ——<Link className="underline" to="/review">去过堂</Link>
            </>
          )}
        </div>
      )}

      <Card className="p-5">
        <MetabolismStrip
          active={d.active}
          decaying={d.decaying.length}
          dormant={d.dormant.length}
        />
        <div className="mt-5 grid grid-cols-3 gap-4 border-t border-line pt-4 sm:grid-cols-6">
          <Stat label="总量" value={String(d.total)} />
          <Stat
            label="L0 判断"
            value={`${d.l0}/${d.l0Cap}`}
            sub={d.l0 >= d.l0Cap ? "已满——先挤掉再收新" : undefined}
          />
          <Stat label="未分诊" value={String(d.untriaged)} />
          <Stat label="孤儿（0 反链）" value={String(d.orphans)} />
          <Stat label="门流量 7 天" value={`${d.reads7d + d.searches7d}`} sub={`读 ${d.reads7d} · 检 ${d.searches7d}`} />
          <Stat
            label="吸收 30 天"
            value={String(absorbed)}
            sub={absorbed === 0 ? "存而不用=图书管理员" : "喂养了创造"}
          />
        </div>
      </Card>

      <h2 className="mb-2 mt-6 text-xs font-medium tracking-wide text-ash">
        此刻该做的事（每周 5 分钟的全部）
      </h2>
      {nothingTodo ? (
        <Empty title="代谢健康，此刻什么都不用做。">
          笔记照常写，检索交给接了门的 agent；门会在该消化的时候提醒你。
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <TodoCard
            to="/triage"
            count={todo.untriaged}
            title="待分诊"
            desc="新进的笔记还没定层——写不出用途的只能进 inbox。"
          />
          <TodoCard
            to="/review"
            count={todo.pendingReview}
            title="待过堂"
            desc="法医的处决名单等你判决——AI 只提案，你是法官。"
          />
          <TodoCard
            to="/chew"
            count={todo.chewCandidates}
            title="可消化"
            desc="反复被读的资料值得提炼成一句你自己的判断。"
          />
        </div>
      )}

      {d.embedding && (
        <Card className="mt-6 p-4">
          <h2 className="text-xs font-medium tracking-wide text-ash">语义层</h2>
          <div className="mt-2 flex flex-wrap gap-6 font-mono text-sm">
            <span>
              向量覆盖 {d.embedding.vectors}/{d.total}
            </span>
            <span>
              key：
              {d.embedding.keySource === "env"
                ? "环境变量（临时）"
                : d.embedding.keySource === "file"
                  ? ".kb/secrets.json"
                  : "未配置——检索一直是纯字面"}
            </span>
          </div>
          {d.embedding.secretsTracked && (
            <div className="mt-2 rounded border border-seal/40 bg-seal-soft px-3 py-2 text-sm text-seal">
              🚨 .kb/secrets.json 被 git 跟踪，key 已进历史——立即 git rm --cached 并轮换 key
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
