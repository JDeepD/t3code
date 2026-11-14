import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { attachBtwSideChat, closeBtw, setBtwDraft, startBtw, useBtwStore } from "./btwStore";

const parentRef = scopeThreadRef(EnvironmentId.make("env"), ThreadId.make("parent"));
const openSession = () => Object.values(useBtwStore.getState().sessions)[0];

function setup() {
  useBtwStore.setState({ sessions: {} }, true);
}

describe("btwStore", () => {
  it("attaches the side chat a send started and clears the sent draft", async () => {
    setup();
    await startBtw(parentRef, "quote");
    const session = openSession()!;
    setBtwDraft(parentRef, session.id, "why?");
    attachBtwSideChat(parentRef, session.id, ThreadId.make("side"));
    expect(openSession()).toEqual({
      id: session.id,
      quote: "quote",
      draft: "",
      sideChatThreadId: "side",
    });
  });

  it("ignores a send that finishes after its overlay was replaced or closed", async () => {
    setup();
    await startBtw(parentRef, "first");
    const first = openSession()!;
    await startBtw(parentRef, "second");
    const second = openSession()!;
    attachBtwSideChat(parentRef, first.id, ThreadId.make("late"));
    expect(openSession()).toEqual(second);

    closeBtw(parentRef, second.id);
    attachBtwSideChat(parentRef, second.id, ThreadId.make("late"));
    expect(useBtwStore.getState().sessions).toEqual({});
  });
});
