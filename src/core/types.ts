export type JudgmentProviderKind = "human" | "anthropic" | "agent";

export type VaultConfig = {
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
};

export type Vault = {
  root: string;
  config: VaultConfig;
};

export type NoteRow = {
  path: string;
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
  path?: string;
};

export type TierDecision = {
  path: string;
  tier: "L0" | "L1" | "inbox";
  useWhen?: string;
  reason?: string;
};
