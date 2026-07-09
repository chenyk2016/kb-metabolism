import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { NoteDrawer } from "../components/NoteDrawer";
import {
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Input,
  Loading,
  Modal,
  Path,
  Textarea,
  TierBadge,
  ViewHeader,
  VitalityBar,
  cn,
} from "../components/ui";
import { agoText, vitality } from "../format";

const TABS = [
  { key: "all", label: "全部" },
  { key: "L0", label: "L0" },
  { key: "L1", label: "L1" },
  { key: "inbox", label: "inbox" },
  { key: "untriaged", label: "未分诊" },
  { key: "graveyard", label: "墓地" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function Graveyard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["graveyard"], queryFn: api.graveyard });
  const restore = useMutation({
    mutationFn: api.restore,
    onSuccess: () => qc.invalidateQueries(),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data || q.data.items.length === 0)
    return <Empty title="墓地是空的。">被处决的笔记会移进 _graveyard/，git 保证随时可反悔。</Empty>;
  return (
    <Card>
      {restore.error && (
        <div className="p-3">
          <ErrorBox error={restore.error} />
        </div>
      )}
      <table className="w-full text-sm">
        <tbody>
          {q.data.items.map((it) => (
            <tr key={it.file} className="border-b border-line last:border-0">
              <td className="px-4 py-2.5">
                <Path>{it.file}</Path>
              </td>
              <td className="px-4 py-2.5 text-right text-xs text-faint">掩埋于 {agoText(it.mtime)}</td>
              <td className="w-24 px-4 py-2.5 text-right">
                <Button
                  variant="alive"
                  className="px-2 py-1 text-xs"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(it.file)}
                >
                  还魂
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-line px-4 py-2 text-xs text-faint">
        还魂 = git mv 回库根目录。真删除永远归人手动——界面不提供。
      </div>
    </Card>
  );
}

function AddNoteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [useWhen, setUseWhen] = useState("");
  const add = useMutation({ mutationFn: api.addNote });

  const similar = add.data && add.data.created === null ? add.data.similar : null;
  const created = add.data?.created ?? null;

  const submit = (force: boolean) =>
    add.mutate(
      { title, content, useWhen: useWhen.trim() || undefined, force },
      {
        onSuccess: (r) => {
          if (r.created) {
            qc.invalidateQueries();
          }
        },
      }
    );

  const close = () => {
    add.reset();
    setTitle("");
    setContent("");
    setUseWhen("");
    onClose();
  };

  return (
    <Modal open={open} onClose={close}>
      <h2 className="mb-3 text-base font-semibold">捕捉笔记</h2>
      <div className="space-y-3">
        <Field label="标题">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label="正文" hint="Markdown">
          <Textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} />
        </Field>
        <Field
          label="什么时候会再用到？"
          hint="入口税：留空只能进 inbox，30 天后过期"
        >
          <Input
            value={useWhen}
            onChange={(e) => setUseWhen(e.target.value)}
            placeholder="如：下次选全文检索引擎时"
          />
        </Field>

        {add.error && <ErrorBox error={add.error} />}
        {similar && (
          <div className="rounded border border-decay/40 bg-decay-soft p-3 text-sm">
            <div className="font-medium text-decay">
              未写入——发现 {similar.length} 篇疑似同主题：
            </div>
            <ul className="mt-2 space-y-1">
              {similar.map((s) => (
                <li key={s.path}>
                  <Path>{s.path}</Path>
                  <span className="ml-2 text-xs text-ash">
                    {s.title}（相似 {Math.round(s.coverage * 100)}%）
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 text-xs text-ash">
              一个主题一篇笔记：优先去编辑已有文件补充；确认是新主题再强制新增。
            </div>
          </div>
        )}
        {created && (
          <div className="rounded border border-alive/40 bg-alive-soft px-3 py-2 text-sm text-alive">
            已捕捉：{created}（{useWhen.trim() ? "L1" : "inbox，30 天限期"}）
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={close}>
            {created ? "完成" : "取消"}
          </Button>
          {similar ? (
            <Button variant="seal" onClick={() => submit(true)} disabled={add.isPending}>
              确认新主题，强制新增
            </Button>
          ) : (
            !created && (
              <Button
                variant="primary"
                onClick={() => submit(false)}
                disabled={!title.trim() || add.isPending}
              >
                捕捉（先过查重税）
              </Button>
            )
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function Notes() {
  const [tab, setTab] = useState<TabKey>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const cfg = useQuery({ queryKey: ["config"], queryFn: api.config });
  const decayDays = cfg.data?.config.decayDays ?? 90;

  const notesQ = useQuery({
    queryKey: ["notes", tab],
    queryFn: () => api.notes(tab),
    enabled: tab !== "graveyard" && query.trim() === "",
  });
  const searchQ = useQuery({
    queryKey: ["search", query],
    queryFn: () => api.search(query.trim()),
    enabled: query.trim().length > 0,
  });

  return (
    <div>
      <ViewHeader
        eyebrow="档案柜"
        title="笔记"
        desc="分层浏览与检索。这里的浏览记 kb_ui，不给笔记续命。"
        right={<Button variant="primary" onClick={() => setAdding(true)}>捕捉笔记</Button>}
      />

      <div className="mb-4 flex items-center gap-4">
        <div className="flex rounded border border-line bg-card p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                setQuery("");
              }}
              className={cn(
                "rounded px-3 py-1 text-sm",
                tab === t.key ? "bg-ink text-card" : "text-ash hover:text-ink"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab !== "graveyard" && (
          <Input
            className="max-w-xs"
            placeholder="混合检索（字面+语义）…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </div>

      {tab === "graveyard" ? (
        <Graveyard />
      ) : query.trim() ? (
        searchQ.isLoading ? (
          <Loading />
        ) : searchQ.error ? (
          <ErrorBox error={searchQ.error} />
        ) : searchQ.data && searchQ.data.hits.length > 0 ? (
          <Card>
            {searchQ.data.hits.map((h) => (
              <button
                key={h.path}
                className="block w-full border-b border-line px-4 py-3 text-left last:border-0 hover:bg-paper"
                onClick={() => setSelected(h.path)}
              >
                <div className="text-sm font-medium">{h.title}</div>
                <Path>{h.path}</Path>
                <div className="mt-1 text-xs text-ash">{h.snip}</div>
              </button>
            ))}
          </Card>
        ) : (
          <Empty title={`无结果：${query}`}>库里可能确实没有；刚改过笔记的话先重建索引。</Empty>
        )
      ) : notesQ.isLoading || cfg.isLoading ? (
        <Loading />
      ) : notesQ.error ? (
        <ErrorBox error={notesQ.error} />
      ) : notesQ.data && notesQ.data.notes.length > 0 ? (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-faint">
                <th className="px-4 py-2 font-normal">笔记</th>
                <th className="px-2 py-2 font-normal">层</th>
                <th className="px-2 py-2 font-normal">生命线</th>
                <th className="px-2 py-2 font-normal">最后读取</th>
                <th className="px-2 py-2 font-normal">最后被引</th>
                <th className="px-2 py-2 text-right font-normal">反链</th>
              </tr>
            </thead>
            <tbody>
              {notesQ.data.notes.map((n) => (
                <tr
                  key={n.path}
                  className="cursor-pointer border-b border-line last:border-0 hover:bg-paper"
                  onClick={() => setSelected(n.path)}
                >
                  <td className="max-w-md px-4 py-2.5">
                    <div className="truncate font-medium">{n.title}</div>
                    <Path className="block truncate">{n.path}</Path>
                    {n.use_when && (
                      <div className="mt-0.5 truncate text-xs text-faint">{n.use_when}</div>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    <TierBadge tier={n.tier} />
                  </td>
                  <td className="px-2 py-2.5">
                    <VitalityBar
                      value={vitality(decayDays, n.lastRead, n.lastCite, n.modified)}
                    />
                  </td>
                  <td className="px-2 py-2.5 font-mono text-xs text-ash">{agoText(n.lastRead)}</td>
                  <td className="px-2 py-2.5 font-mono text-xs text-ash">{agoText(n.lastCite)}</td>
                  <td className="px-2 py-2.5 text-right font-mono text-xs text-ash">
                    {n.backlinks}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <Empty title="这一层没有笔记。" />
      )}

      {selected && <NoteDrawer path={selected} onClose={() => setSelected(null)} />}
      <AddNoteModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
