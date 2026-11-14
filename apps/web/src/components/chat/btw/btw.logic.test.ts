import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { type BtwSession, btwHasUnsentText, buildBtwPrompt } from "./btw.logic";

const session = (overrides: Partial<BtwSession> = {}): BtwSession => ({
  id: 1,
  quote: "quoted",
  draft: "",
  sideChatThreadId: null,
  ...overrides,
});

describe("buildBtwPrompt", () => {
  it("quotes every line of the selection, then asks the question", () => {
    expect(buildBtwPrompt("  first line\n\nsecond line\n", "  why?  ")).toBe(
      "> first line\n>\n> second line\n\nwhy?",
    );
  });

  it("keeps Windows line breaks inside the blockquote", () => {
    expect(buildBtwPrompt("a\r\nb", "q")).toBe("> a\n> b\n\nq");
  });
});

describe("btwHasUnsentText", () => {
  it("is false without an open session", () => {
    expect(btwHasUnsentText(undefined, "typed")).toBe(false);
  });

  it("reads the overlay's own draft before the side chat exists", () => {
    expect(btwHasUnsentText(session({ draft: "  " }), "ignored")).toBe(false);
    expect(btwHasUnsentText(session({ draft: "half a question" }), undefined)).toBe(true);
  });

  it("reads the side chat's composer draft once the side chat exists", () => {
    const started = session({ draft: "stale", sideChatThreadId: ThreadId.make("side") });
    expect(btwHasUnsentText(started, undefined)).toBe(false);
    expect(btwHasUnsentText(started, "a follow-up")).toBe(true);
  });
});
