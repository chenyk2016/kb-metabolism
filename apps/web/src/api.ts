/**
 * /api/v1 客户端。类型从 @kb/server/schemas 以 import type 引入——
 * 编译期契约共享，运行时零依赖（vite 会把 type import 全部擦除）。
 */
import type {
  AddNoteResponse,
  ChewCandidatesResponse,
  ConfigResponse,
  DigestResponse,
  ExecuteResponse,
  GraveyardResponse,
  IndexResponse,
  NoteDetailResponse,
  NotesResponse,
  OverviewResponse,
  ReportDetailResponse,
  ReportInfo,
  SearchResponse,
  SignalsResponse,
} from "@kb/server/schemas";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

const BASE = "/api/v1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init);
  const json = (await res.json().catch(() => ({ error: res.statusText }))) as T & {
    error?: string;
  };
  if (!res.ok) throw new ApiError(json.error ?? `HTTP ${res.status}`, res.status);
  return json;
}

const get = <T>(path: string) => request<T>(path);
const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const api = {
  overview: () => get<OverviewResponse>("/overview"),
  notes: (tier: string) => get<NotesResponse>(`/notes?tier=${encodeURIComponent(tier)}`),
  noteDetail: (path: string) =>
    get<NoteDetailResponse>(`/notes/detail?path=${encodeURIComponent(path)}`),
  addNote: (body: {
    title: string;
    content: string;
    tier?: "L0" | "L1" | "inbox";
    useWhen?: string;
    force?: boolean;
  }) => send<AddNoteResponse>("POST", "/notes", body),
  search: (q: string) => get<SearchResponse>(`/search?q=${encodeURIComponent(q)}`),
  signals: (tool?: string) =>
    get<SignalsResponse>(`/signals${tool ? `?tool=${encodeURIComponent(tool)}` : ""}`),
  reports: () => get<{ reports: ReportInfo[] }>("/reports"),
  reportDetail: (file: string) =>
    get<ReportDetailResponse>(`/reports/detail?file=${encodeURIComponent(file)}`),
  reviewApprove: (file: string, lines: number[]) =>
    send<{ ok: boolean }>("POST", "/review/approve", { file, lines }),
  reviewExecute: (file: string) => send<ExecuteResponse>("POST", "/review/execute", { file }),
  triage: (decisions: Array<{ path: string; tier: "L0" | "L1" | "inbox"; useWhen?: string }>) =>
    send<{ applied: number; tiers: Record<string, number> }>("POST", "/triage", { decisions }),
  promote: (body: { path: string; tier: "L0" | "L1"; useWhen: string }) =>
    send<{ path: string; from: string; tier: "L0" | "L1" }>("POST", "/promote", body),
  chewCandidates: () => get<ChewCandidatesResponse>("/chew/candidates"),
  chew: (body: { judgment: string; useWhen: string; evidencePaths: string[] }) =>
    send<{ created: string }>("POST", "/chew", body),
  digest: () => send<DigestResponse>("POST", "/digest"),
  config: () => get<ConfigResponse>("/config"),
  saveConfig: (patch: unknown) => send<ConfigResponse>("PUT", "/config", patch),
  rebuildIndex: () => send<IndexResponse>("POST", "/index"),
  graveyard: () => get<GraveyardResponse>("/graveyard"),
  restore: (file: string) => send<{ restored: string }>("POST", "/graveyard/restore", { file }),
};
