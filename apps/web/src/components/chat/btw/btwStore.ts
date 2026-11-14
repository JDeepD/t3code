import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

import { useComposerDraftStore } from "../../../composerDraftStore";
import { readLocalApi } from "../../../localApi";
import { type BtwSession, btwHasUnsentText } from "./btw.logic";

/** Open overlays by parent thread key. In memory only: the side chat itself is the durable part. */
export const useBtwStore = create<{ readonly sessions: Readonly<Record<string, BtwSession>> }>(
  () => ({ sessions: {} }),
);

let nextSessionId = 1;

function updateSession(
  parentRef: ScopedThreadRef,
  sessionId: number,
  change: (session: BtwSession) => BtwSession | null,
): void {
  const key = scopedThreadKey(parentRef);
  useBtwStore.setState(({ sessions }) => {
    const session = sessions[key];
    if (session?.id !== sessionId) return { sessions };
    const next = change(session);
    if (next === null) {
      const { [key]: _closed, ...rest } = sessions;
      return { sessions: rest };
    }
    return { sessions: { ...sessions, [key]: next } };
  });
}

export function useBtwSession(parentRef: ScopedThreadRef): BtwSession | undefined {
  const key = scopedThreadKey(parentRef);
  return useBtwStore((state) => state.sessions[key]);
}

/** Opens an overlay for `quote`, replacing the thread's open one after a confirm if it has unsent text. */
export async function startBtw(parentRef: ScopedThreadRef, quote: string): Promise<void> {
  const key = scopedThreadKey(parentRef);
  const current = useBtwStore.getState().sessions[key];
  const sideChatDraft =
    current?.sideChatThreadId == null
      ? undefined
      : useComposerDraftStore
          .getState()
          .getComposerDraft(scopeThreadRef(parentRef.environmentId, current.sideChatThreadId))
          ?.prompt;
  if (btwHasUnsentText(current, sideChatDraft)) {
    const confirmed = await readLocalApi()
      ?.dialogs.confirm("Start a new By the way…? The open one has a message you have not sent.")
      .catch(() => false);
    if (confirmed !== true) return;
  }
  const session: BtwSession = {
    id: nextSessionId++,
    quote: quote.trim(),
    draft: "",
    sideChatThreadId: null,
  };
  useBtwStore.setState(({ sessions }) => ({ sessions: { ...sessions, [key]: session } }));
}

export function setBtwDraft(parentRef: ScopedThreadRef, sessionId: number, draft: string): void {
  updateSession(parentRef, sessionId, (session) => ({ ...session, draft }));
}

export function attachBtwSideChat(
  parentRef: ScopedThreadRef,
  sessionId: number,
  sideChatThreadId: ThreadId,
): void {
  updateSession(parentRef, sessionId, (session) => ({ ...session, draft: "", sideChatThreadId }));
}

export function closeBtw(parentRef: ScopedThreadRef, sessionId: number): void {
  updateSession(parentRef, sessionId, () => null);
}
