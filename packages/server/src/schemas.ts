import { z } from "zod";
import type {
  Candidate,
  ChewCandidate,
  DoctorReport,
  ExecuteResult,
  Hit,
  IndexResult,
  NoteRow,
  Signal,
  VaultConfig,
  VaultStats,
} from "@kb/core";

/**
 * API 的两半：请求用 zod（运行时校验），响应用 TS 类型（web 端 import type 共享）。
 * 这是第二个正式产品面——所有客户端（管理台/插件/云）都吃这份契约。
 */

// ── 请求 schemas ─────────────────────────────────────

export const TierSchema = z.enum(["L0", "L1", "inbox"]);

/** 报告文件只认 basename，杜绝路径拼接 */
export const ReportFileSchema = z
  .string()
  .regex(/^[a-z-]+-\d{4}-\d{2}-\d{2}\.md$/, "非法报告文件名");

export const ReviewApproveSchema = z.object({
  file: ReportFileSchema,
  lines: z.array(z.number().int().nonnegative()),
});

export const ReviewExecuteSchema = z.object({ file: ReportFileSchema });

export const TriageSchema = z.object({
  decisions: z
    .array(
      z.object({
        path: z.string().min(1),
        tier: TierSchema,
        useWhen: z.string().optional(),
      })
    )
    .min(1),
});

export const ChewSchema = z.object({
  judgment: z.string().min(1),
  useWhen: z.string().min(1),
  evidencePaths: z.array(z.string().min(1)).min(1),
});

export const AddNoteSchema = z.object({
  title: z.string().min(1),
  content: z.string().default(""),
  tier: TierSchema.optional(),
  useWhen: z.string().optional(),
  dir: z.string().optional(),
  force: z.boolean().default(false),
});

export const GraveyardRestoreSchema = z.object({
  file: z.string().regex(/^[^/\\]+\.md$/, "非法文件名"),
});

/** config 白名单：能改什么在这里一目了然；secrets 永远不在其中 */
export const ConfigPatchSchema = z
  .object({
    managed: z.array(z.string().min(1)).min(1).optional(),
    exclude: z.array(z.string()).optional(),
    captureDir: z.string().min(1).optional(),
    l0Cap: z.number().int().positive().optional(),
    inboxDays: z.number().int().positive().optional(),
    decayDays: z.number().int().positive().optional(),
    citeDays: z.number().int().positive().optional(),
    outputDirs: z.array(z.string()).optional(),
    judgment: z
      .object({
        provider: z.enum(["human", "anthropic", "agent"]).optional(),
        triageModel: z.string().min(1).optional(),
        digestModel: z.string().min(1).optional(),
      })
      .optional(),
    /** null = 关闭语义检索 */
    embedding: z
      .object({
        baseUrl: z.string().url(),
        model: z.string().min(1),
        apiKeyEnv: z.string().optional(),
        dimensions: z.number().int().positive().optional(),
      })
      .nullable()
      .optional(),
  })
  .strict();

// ── 响应类型（web 端 import type 用） ────────────────

export type TodoCounts = {
  untriaged: number;
  pendingReview: number;
  chewCandidates: number;
};

export type OverviewResponse = {
  doctor: DoctorReport;
  stats: VaultStats;
  reminder: string | null;
  todo: TodoCounts;
};

export type NoteListItem = NoteRow & {
  backlinks: number;
  lastRead: string | null;
  lastCite: string | null;
};

export type NotesResponse = { notes: NoteListItem[] };

export type NoteDetailResponse = {
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  backlinks: string[];
  signals: Signal[];
};

export type SearchResponse = { hits: Hit[] };

export type SignalsResponse = { signals: Signal[]; tools: string[] };

export type ReportKind = "kill-list" | "health" | "chew-list" | "other";

export type ReportInfo = {
  file: string;
  kind: ReportKind;
  date: string;
  /** 仅 kill-list：待审/已勾选计数 */
  pending?: number;
  approved?: number;
};

export type KillListItem = {
  line: number;
  path: string;
  rest: string;
  checked: boolean;
  preview: string;
  exists: boolean;
};

export type ReportDetailResponse = {
  file: string;
  kind: ReportKind;
  content: string;
  items?: KillListItem[];
};

export type DigestResponse = {
  report: string;
  candidates: Candidate[];
  health: string;
  chewList: string | null;
};

export type ChewCandidatesResponse = { candidates: ChewCandidate[] };

export type AddNoteResponse =
  | { created: string; tier: string }
  | { created: null; similar: Array<{ path: string; title: string; snip: string; coverage: number }> };

export type ConfigResponse = {
  root: string;
  version: number;
  config: VaultConfig;
  /** 只暴露"配没配"，key 本体永不经过任何 API */
  embeddingKeyConfigured: boolean;
};

export type GraveyardItem = { file: string; mtime: string };

export type GraveyardResponse = { items: GraveyardItem[] };

export type ExecuteResponse = ExecuteResult;
export type IndexResponse = IndexResult;

export type ApiError = { error: string };
