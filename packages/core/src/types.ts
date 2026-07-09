export type JudgmentProviderKind = "human" | "anthropic" | "agent";

export type EmbeddingConfig = {
  /** 任何 OpenAI 兼容的 /v1 端点（硅基流动、Voyage、OpenAI、Ollama…） */
  baseUrl: string;
  model: string;
  /** 存放 API key 的环境变量名（config 会进 git，key 永不落盘），默认 KB_EMBEDDING_API_KEY */
  apiKeyEnv?: string;
  dimensions?: number;
};

export type VaultConfig = {
  /** 代谢协议版本——config/frontmatter 约定演进的迁移锚点（缺省视为 1） */
  version?: number;
  /** globs (relative to vault root) of managed notes */
  managed: string[];
  exclude: string[];
  /** where `kb add` puts new notes, relative to vault root */
  captureDir: string;
  l0Cap: number;
  inboxDays: number;
  decayDays: number;
  judgment: {
    provider: JudgmentProviderKind;
    /** triage is high-frequency low-stakes judgment — cheap model */
    triageModel: string;
    /** digest proposals deserve the top model */
    digestModel: string;
  };
  /** 语义检索插件；不配置 = 纯字面检索，零依赖不变量不破 */
  embedding?: EmbeddingConfig;
  /** 创作目录（相对 vault 根）：其中对管理笔记的引用 = 铁证级吸收信号 */
  outputDirs?: string[];
  /** 被引用（kb_cite）的免死窗口，默认 180 天（读取是 decayDays=90） */
  citeDays?: number;
};

export type Vault = {
  root: string;
  config: VaultConfig;
};

export type NoteRow = {
  path: string;
  /** 稳定身份（frontmatter kb_id）；索引自愈补发，正常情况下非空 */
  id: string | null;
  title: string;
  tier: string | null;
  use_when: string | null;
  triaged: string | null;
  expires: string | null;
  created: string;
  modified: string;
  hash: string;
};

export type Signal = {
  ts: string;
  tool: string;
  query?: string;
  /** 记录时刻的路径——给人读日志用；认领笔记以 id 为准 */
  path?: string;
  /** 笔记稳定身份（kb_id）——移动/改名后信号仍可认领 */
  id?: string;
};

export type TierDecision = {
  path: string;
  tier: "L0" | "L1" | "inbox";
  useWhen?: string;
  reason?: string;
};
