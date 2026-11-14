import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { ArrowUpIcon, PanelRightIcon, XIcon } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { useComposerDraftStore } from "../../../composerDraftStore";
import { ComposerHandleContext } from "../../../composerHandleContext";
import type { SideChatParentPanel } from "../../../lib/sideChatPane";
import { cn } from "../../../lib/utils";
import { selectThreadRightPanelState, useRightPanelStore } from "../../../rightPanelStore";
import ChatView from "../../ChatView";
import { Button } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
import { Textarea } from "../../ui/textarea";
import { BackgroundThreadContext } from "../backgroundThread";
import { type BtwSession, btwQuoteIsLong, buildBtwPrompt } from "./btw.logic";
import { attachBtwSideChat, closeBtw, setBtwDraft, useBtwSession } from "./btwStore";

/** The open "By the way…" for `parentRef`, docked above its composer. */
export function BtwOverlay(props: {
  readonly parentRef: ScopedThreadRef;
  readonly parentPanel: SideChatParentPanel;
  readonly startSideChat: (prompt: string) => Promise<ThreadId | null>;
}) {
  const session = useBtwSession(props.parentRef);
  const sideChatThreadId = session?.sideChatThreadId ?? null;
  // A side chat open in the panel too would mount two composers on one draft.
  const shownInPanel = useRightPanelStore(
    (state) =>
      sideChatThreadId !== null &&
      selectThreadRightPanelState(state.byThreadKey, props.parentRef).surfaces.some(
        (surface) => surface.id === `side-chat:${sideChatThreadId}`,
      ),
  );
  if (session === undefined || shownInPanel) return null;
  return (
    <BtwOverlayContent
      key={`${scopedThreadKey(props.parentRef)}:${session.id}`}
      {...props}
      session={session}
    />
  );
}

function BtwOverlayContent(props: {
  readonly parentRef: ScopedThreadRef;
  readonly parentPanel: SideChatParentPanel;
  readonly startSideChat: (prompt: string) => Promise<ThreadId | null>;
  readonly session: BtwSession;
}) {
  const { parentRef, session } = props;
  const [sending, setSending] = useState(false);
  const [quoteExpanded, setQuoteExpanded] = useState(false);
  const sideChatRef =
    session.sideChatThreadId === null
      ? null
      : scopeThreadRef(parentRef.environmentId, session.sideChatThreadId);
  const close = () => closeBtw(parentRef, session.id);

  const send = async () => {
    const question = session.draft.trim();
    if (question === "" || sending) return;
    setSending(true);
    const threadId = await props.startSideChat(buildBtwPrompt(session.quote, question));
    setSending(false);
    if (threadId !== null) attachBtwSideChat(parentRef, session.id, threadId);
  };

  const openInPanel = () => {
    if (session.sideChatThreadId === null) return;
    useRightPanelStore.getState().openSideChat(parentRef, session.sideChatThreadId);
    close();
  };

  const onQuestionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    } else if (event.key === "Escape" && session.draft.trim() === "") {
      event.preventDefault();
      close();
    }
  };

  // The embedded composer handles its own keys first; an Escape it leaves alone closes when empty.
  const onSideChatKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (sideChatRef === null) return;
    const target = event.target as HTMLElement;
    if (!target.isContentEditable && target.tagName !== "TEXTAREA") return;
    const prompt = useComposerDraftStore.getState().getComposerDraft(sideChatRef)?.prompt ?? "";
    if (prompt.trim() !== "") return;
    event.preventDefault();
    close();
  };

  const quoteIsLong = btwQuoteIsLong(session.quote);

  return (
    <div
      data-side-chat-pane
      className="absolute inset-x-0 bottom-full z-20 mb-2 flex max-h-[min(32rem,60vh)] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">By the way…</span>
        <Button
          variant="ghost"
          size="xs"
          disabled={session.sideChatThreadId === null}
          onClick={openInPanel}
        >
          <PanelRightIcon />
          Open in panel
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Close By the way…" onClick={close}>
          <XIcon />
        </Button>
      </div>
      {sideChatRef === null ? (
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-3">
          <blockquote className="border-l-2 border-border pl-3 text-sm text-muted-foreground">
            <p
              className={cn("whitespace-pre-wrap", quoteIsLong && !quoteExpanded && "line-clamp-2")}
            >
              {session.quote}
            </p>
            {quoteIsLong ? (
              <Button
                variant="link"
                size="xs"
                onClick={() => setQuoteExpanded((expanded) => !expanded)}
              >
                {quoteExpanded ? "Show less" : "Show more"}
              </Button>
            ) : null}
          </blockquote>
          <div className="flex items-end gap-2">
            <Textarea
              autoFocus
              rows={2}
              size="sm"
              placeholder="Ask in this btw session…"
              aria-label="Ask in this btw session"
              value={session.draft}
              disabled={sending}
              onChange={(event) => setBtwDraft(parentRef, session.id, event.target.value)}
              onKeyDown={onQuestionKeyDown}
            />
            <Button
              size="icon-sm"
              aria-label="Send"
              disabled={sending || session.draft.trim() === ""}
              onClick={() => void send()}
            >
              {sending ? <Spinner /> : <ArrowUpIcon />}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex h-[min(28rem,50vh)] min-h-0 flex-col" onKeyDown={onSideChatKeyDown}>
          <BackgroundThreadContext value>
            <ComposerHandleContext value={null}>
              <ChatView
                environmentId={parentRef.environmentId}
                threadId={sideChatRef.threadId}
                routeKind="server"
                embedded={props.parentPanel}
              />
            </ComposerHandleContext>
          </BackgroundThreadContext>
        </div>
      )}
    </div>
  );
}
