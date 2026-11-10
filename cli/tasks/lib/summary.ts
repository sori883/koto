import type { Progress, Task } from "./model.ts";

export const SUMMARY_FILE = "tasks.md";
export const SUMMARY_MARKER = "<!-- koto Tasks による自動出力 -->\n";

const stateLabels: Record<Progress, string> = {
  pending: "未着手",
  running: "作業中",
  waiting: "待ち",
  paused: "中断",
  completed: "完了",
  cancelled: "中止",
};

function markdownText(text: string) {
  return text.replace(/\r\n?/g, "\n").split("\n").map(line => line.trim()
    .replace(/[\\`*_{}\[\]<>#&|~]/g, "\\$&")
    .replace(/^[-+=]/, "\\$&")
    .replace(/^(\d+)([.)])(?=\s|$)/, "$1\\$2")
  ).join("\n").replace(/(\S)\n(?=\S)/g, "$1  \n");
}

function markdownLine(text: string) {
  return markdownText(text.replace(/[\r\n]+/g, " "));
}

function stateLabel(task: Task) {
  return stateLabels[task.state] + "（" + task.state + "）";
}

export function taskSummary(task: Task, children: Task[]): string {
  const lines = [
    SUMMARY_MARKER,
    "# " + markdownLine(task.title),
    "",
    "- タスク ID " + "`" + task.id + "`",
    "- 状態 " + stateLabel(task),
    "- 試行 " + task.attempt,
    "- 版 " + task.version,
    "- 更新日時 " + task.updatedAt,
  ];
  if (task.dependencies.length) lines.push("- 先行タスク " + task.dependencies.map(id => "`" + id + "`").join("、"));
  const sections = [
    ["内容", task.description],
    ["理由", task.reason],
    ["次の操作", task.next],
    ["完了結果", task.result],
  ] as const;
  for (const [heading, content] of sections) {
    if (content?.trim()) lines.push("", "## " + heading, "", markdownText(content));
  }
  if (children.length) {
    lines.push("", "## 子タスク", "");
    for (const child of children) {
      lines.push("- " + markdownLine(child.title) + " · `" + child.id + "` · " + stateLabel(child));
      if (child.reason.trim()) lines.push("  - 理由 " + markdownLine(child.reason));
      if (child.next.trim()) lines.push("  - 次の操作 " + markdownLine(child.next));
    }
  }
  return lines.join("\n") + "\n";
}
