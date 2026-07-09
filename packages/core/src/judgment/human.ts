import readline from "node:readline";
import type { TierDecision } from "../types.js";

export type UntriagedNote = { path: string; title: string; head: string };

/**
 * Buffered line reader: lines are queued as they arrive, so piped stdin
 * (where all lines land in one chunk before the first question is asked)
 * behaves exactly like interactive input. On EOF, pending asks resolve "".
 */
export class LineReader {
  private queue: string[] = [];
  private waiters: Array<(s: string) => void> = [];
  private closed = false;
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({ input: process.stdin, terminal: false });
    this.rl.on("line", (l) => {
      const w = this.waiters.shift();
      if (w) w(l);
      else this.queue.push(l);
    });
    this.rl.on("close", () => {
      this.closed = true;
      for (const w of this.waiters.splice(0)) w("");
    });
  }

  async ask(prompt: string): Promise<string> {
    process.stdout.write(prompt);
    const buffered = this.queue.shift();
    if (buffered !== undefined) {
      process.stdout.write("\n");
      return buffered;
    }
    if (this.closed) {
      process.stdout.write("\n");
      return "";
    }
    return new Promise((res) => this.waiters.push(res));
  }

  close(): void {
    this.rl.close();
  }
}

/**
 * The zero-dependency judgment provider: the human decides, interactively.
 * The system is fully usable without any LLM — that is the point.
 */
export async function humanTriage(notes: UntriagedNote[]): Promise<TierDecision[]> {
  const reader = new LineReader();
  const decisions: TierDecision[] = [];

  try {
    for (const [i, n] of notes.entries()) {
      console.log(`\n[${i + 1}/${notes.length}] ${n.path}`);
      console.log(`  ${n.title}`);
      const head = n.head.replace(/\s+/g, " ").slice(0, 240);
      if (head) console.log(`  ${head}…`);

      const answer = (
        await reader.ask("  定层？[0]=L0 [1]=L1 [i]=inbox [s]=跳过 [q]=退出 > ")
      )
        .trim()
        .toLowerCase();

      if (answer === "q") break;
      if (answer === "s" || answer === "") continue;

      if (answer === "0" || answer === "1") {
        const tier = answer === "0" ? "L0" : "L1";
        const useWhen = (
          await reader.ask("  什么时候会再用到？（留空 = 降级到 inbox）> ")
        ).trim();
        if (!useWhen) {
          // entry tax: no use_when, no L0/L1
          decisions.push({ path: n.path, tier: "inbox", reason: "未给出 use_when" });
        } else {
          decisions.push({ path: n.path, tier, useWhen });
        }
      } else if (answer === "i") {
        decisions.push({ path: n.path, tier: "inbox" });
      }
    }
  } finally {
    reader.close();
  }
  return decisions;
}

export async function confirm(prompt: string): Promise<boolean> {
  const reader = new LineReader();
  try {
    const answer = (await reader.ask(`${prompt} [y=是/N=否] > `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    reader.close();
  }
}
