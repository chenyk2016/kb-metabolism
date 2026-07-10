import { execFileSync } from "node:child_process";

/**
 * 内容年龄：每个现存文件"最后一次真实内容变更"的时间——法医与体检共用同一口径。
 *
 * 一次全仓 git log 扫描，两类提交不算触碰：
 *   - rename（git mv 整理目录 ≠ 使用，与 kb_id 身份设计同理：移动是安全动作）
 *   - 批量提交（单提交文件数 > bulkThreshold：迁移/格式化/批量补 frontmatter）
 * rename 仍记入别名链，让旧路径下的更老历史认领到当前路径；
 * 触碰全被过滤的文件回退出生时间——批量导入的新笔记因此仍有正确年龄。
 *
 * 两个"路径对不上就全量静默回退 mtime"的陷阱必须显式处理：
 *   - `-c core.quotepath=false`：否则中文路径被转义成带引号的八进制；
 *   - vault 可以是仓库的子目录（git log 路径相对仓库根）：用 --show-prefix 剥前缀。
 */
export function contentAgeMap(root: string, bulkThreshold: number): Map<string, string> | null {
  let out: string;
  let prefix: string;
  try {
    prefix = execFileSync("git", ["-C", root, "rev-parse", "--show-prefix"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim(); // vault 相对仓库根的前缀，仓库根即 vault 时为空串
    out = execFileSync(
      "git",
      ["-C", root, "-c", "core.quotepath=false", "log", "-M", "--pretty=format:%cI", "--name-status"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 }
    );
  } catch {
    return null; // 非 git 仓库——调用方回退 mtime
  }

  type Entry = { status: string; path: string; toPath?: string };
  type Commit = { date: string; entries: Entry[] };
  const commits: Commit[] = [];
  let current: Commit | null = null;
  for (const line of out.split("\n")) {
    if (/^\d{4}-\d{2}-\d{2}T/.test(line)) {
      current = { date: line.trim(), entries: [] };
      commits.push(current);
    } else if (current && line.includes("\t")) {
      const parts = line.split("\t");
      const status = parts[0];
      if (status.startsWith("R") || status.startsWith("C")) {
        if (parts.length >= 3) {
          // copy = 新路径的诞生（来源文件仍在，不建别名）；rename 走别名链
          if (status.startsWith("C")) current.entries.push({ status: "A", path: parts[2] });
          else current.entries.push({ status, path: parts[1], toPath: parts[2] });
        }
      } else if (parts.length >= 2) {
        current.entries.push({ status, path: parts[1] });
      }
    }
  }

  const alias = new Map<string, string>(); // 历史路径 → 当前路径
  const resolve = (p: string): string => {
    let cur = p;
    const seen = new Set<string>();
    while (alias.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = alias.get(cur)!;
    }
    return cur;
  };

  // 内部全程用仓库相对全路径（别名链跨 vault 边界也成立），产出时才剥前缀
  const inVault = (p: string) => p.startsWith(prefix);
  const lastChanged = new Map<string, string>();
  const firstSeen = new Map<string, string>();
  for (const c of commits) {
    // git log 输出新 → 老：首见即最新。批量判定只数 vault 内文件——
    // 仓库里 vault 之外的噪音（会话、配置）不该把小编辑衬成批量
    const isBulk =
      c.entries.filter((e) => inVault(e.status.startsWith("R") ? e.toPath! : e.path)).length >
      bulkThreshold;
    for (const e of c.entries) {
      if (e.status.startsWith("R")) {
        const target = resolve(e.toPath!);
        if (target !== e.path) alias.set(e.path, target); // 防来回改名成环
        continue;
      }
      if (e.status.startsWith("D")) continue;
      const cur = resolve(e.path);
      firstSeen.set(cur, c.date); // 无条件覆盖：越走越老，最终 = 出生时间
      if (!isBulk && !lastChanged.has(cur)) lastChanged.set(cur, c.date);
    }
  }
  for (const [p, born] of firstSeen) {
    if (!lastChanged.has(p)) lastChanged.set(p, born);
  }
  const result = new Map<string, string>();
  for (const [p, d] of lastChanged) {
    if (inVault(p)) result.set(p.slice(prefix.length), d);
  }
  return result;
}
