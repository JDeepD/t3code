import type { MagicPromptTemplate } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { magicPromptCommandItems } from "./magicPromptCommands";

const template = (command: string | undefined, title: string): MagicPromptTemplate => ({
  id: `session.${title}`,
  group: "session",
  title,
  description: "",
  placeholders: [],
  ...(command === undefined ? {} : { command }),
  hasVisiblePrompt: command !== "commit",
  visible: "x",
  instructions: "",
  source: "builtin",
});

const templates = [
  template("review", "Review changes"),
  template("debug", "Debug"),
  template("catch-up", "Catch me up"),
  template(undefined, "Plan a todo"),
  template("commit", "Commit message"),
];
const labels = (query: string, taken: ReadonlyArray<string> = []) =>
  magicPromptCommandItems(templates, query, taken).map((item) => item.label);

describe("magicPromptCommandItems", () => {
  it("offers only templates that have a command and a visible prompt", () => {
    expect(labels("")).toEqual(["/review", "/debug", "/catch-up"]);
  });

  it("ranks a name that starts with the query above one that contains it", () => {
    expect(labels("de")).toEqual(["/debug"]);
    expect(labels("u")).toEqual(["/debug", "/catch-up"]);
    expect(labels("changes")).toEqual(["/review"]);
  });

  it("lets a provider command or skill of the same name win", () => {
    expect(labels("", ["Review", "compact"])).toEqual(["/debug", "/catch-up"]);
  });
});
