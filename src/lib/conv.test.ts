// bun test src/lib/conv.test.ts
import { expect, test } from "bun:test";
import { fold, toolTitle, type ConvItem } from "./conv";

const t = "2026-11-27T10:00:00.000Z";

test("tool results fold into the tool item instead of becoming user messages", () => {
  const items = new Map<string, ConvItem>();
  let changed = fold(items, [
    { type: "user", uuid: "u1", timestamp: t, content: "fix the bug" },
    { type: "assistant", uuid: "a1", timestamp: t, content: [{ type: "thinking", thinking: "…" }] },
    { type: "assistant", uuid: "a2", timestamp: t, content: [{ type: "text", text: "Looking." }] },
    { type: "assistant", uuid: "a3", timestamp: t, content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls -la\necho" } }] },
  ]);
  expect(changed).toEqual(["u1", "a2:0", "toolu_1"]);
  expect([...items.values()].map((i) => i.role)).toEqual(["user", "assistant", "tool"]);
  expect(items.get("toolu_1")).toMatchObject({ title: "Bash ls -la", status: "pending" });

  changed = fold(items, [{ type: "user", uuid: "u2", timestamp: t, content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "a\nb", is_error: true }] }]);
  expect(changed).toEqual(["toolu_1"]);
  expect(items.size).toBe(3); // no fourth "user" item
  expect(items.get("toolu_1")).toMatchObject({ detail: "a\nb", status: "error" });
});

test("meta lines and local command output are skipped; slash commands show their name", () => {
  const items = new Map<string, ConvItem>();
  fold(items, [
    { type: "user", uuid: "m", timestamp: t, isMeta: true, content: "injected context" },
    { type: "user", uuid: "l", timestamp: t, content: "<local-command-stdout>x</local-command-stdout>" },
    { type: "user", uuid: "c", timestamp: t, content: "<command-message>dcp</command-message>\n<command-name>/dcp</command-name>\n<command-args>now</command-args>" },
  ]);
  expect([...items.values()].map((i) => i.text)).toEqual(["/dcp now"]);
});

test("tool titles pick the field a person looks at and cap long ones", () => {
  expect(toolTitle("Read", { file_path: "/a/b.ts" })).toBe("Read /a/b.ts");
  expect(toolTitle("Agent", { description: "find callers", prompt: "long" })).toBe("Agent find callers");
  expect(toolTitle("X", {})).toBe("X");
  expect(toolTitle("Bash", { command: "x".repeat(300) }).length).toBe(100);
});
