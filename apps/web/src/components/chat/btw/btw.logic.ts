import type { ThreadId } from "@t3tools/contracts";

/** One thread's "By the way…" overlay: the quoted selection and, once sent, its side chat. */
export interface BtwSession {
  readonly id: number;
  readonly quote: string;
  readonly draft: string;
  readonly sideChatThreadId: ThreadId | null;
}

/** The side chat's first message: the quote as a markdown blockquote, then the question. */
export function buildBtwPrompt(quote: string, question: string): string {
  const quoted = quote
    .trim()
    .split(/\r?\n/)
    .map((line) => (line.trim() === "" ? ">" : `> ${line}`))
    .join("\n");
  return `${quoted}\n\n${question.trim()}`;
}

/** Whether replacing `session` would drop text typed in it but not sent. */
export function btwHasUnsentText(
  session: BtwSession | undefined,
  sideChatDraft: string | undefined,
): boolean {
  if (session === undefined) return false;
  const unsent = session.sideChatThreadId === null ? session.draft : (sideChatDraft ?? "");
  return unsent.trim() !== "";
}

/** Long quotes start clamped to two lines with a toggle. */
export function btwQuoteIsLong(quote: string): boolean {
  return quote.length > 160 || quote.split("\n").length > 2;
}
