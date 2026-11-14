import type {
  EnvironmentId,
  KnowledgeSource,
  ProjectId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { DraftId } from "~/composerDraftStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { knowledgeEnvironment } from "~/state/knowledge";
import { useAtomCommand } from "~/state/use-atom-command";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { type NoteFromChat, noteBodyFromText, sourceExcerpt } from "./knowledge.logic";

/** Appends `text` to the thread's composer draft as its own paragraph. */
export function insertIntoComposer(target: ScopedThreadRef | DraftId, text: string) {
  const store = useComposerDraftStore.getState();
  const prompt = store.getComposerDraft(target)?.prompt ?? "";
  store.setPrompt(target, prompt.trim() === "" ? text : `${prompt.trimEnd()}\n\n${text}`);
  toastManager.add(
    stackedThreadToast({
      type: "success",
      title: "Added to the composer",
      data: { hideCopyButton: true },
    }),
  );
}

/** Shows a failed command's reason as a toast, then hands the result back. */
function reported<A, E>(title: string, result: AtomCommandResult<A, E>) {
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  return result;
}

/** Saves chat text as a project note and offers to open the panel. */
export function useAddToNotes(threadRef: ScopedThreadRef | null, projectId: ProjectId | null) {
  const save = useAtomCommand(knowledgeEnvironment.save, {
    label: "add to notes",
    reportFailure: false,
  });
  return async (note: NoteFromChat) => {
    if (threadRef === null || projectId === null) return;
    const source: KnowledgeSource = {
      threadId: threadRef.threadId,
      messageId: note.messageId,
      excerpt: sourceExcerpt(note.text),
      ...(note.citation === null ? {} : { citation: note.citation }),
    };
    const result = reported(
      "Could not add the note",
      await save({
        environmentId: threadRef.environmentId,
        input: { kind: "note", projectId, body: noteBodyFromText(note.text), source },
      }),
    );
    if (result._tag !== "Success") return;
    const toastId = toastManager.add(
      stackedThreadToast({
        type: "success",
        title: "Added to notes",
        timeout: 5_000,
        actionProps: {
          children: "Open",
          onClick: () => {
            toastManager.close(toastId);
            useRightPanelStore.getState().open(threadRef, "knowledge");
          },
        },
        data: { hideCopyButton: true },
      }),
    );
  };
}

/** The panel's writes, bound to one environment and project. */
export function useKnowledgeCommands(environmentId: EnvironmentId) {
  const quiet = { reportFailure: false };
  const save = useAtomCommand(knowledgeEnvironment.save, quiet);
  const remove = useAtomCommand(knowledgeEnvironment.delete, quiet);
  const writePlan = useAtomCommand(knowledgeEnvironment.writePlan, quiet);
  type SaveInput = Parameters<typeof save>[0]["input"];
  type DeleteInput = Parameters<typeof remove>[0]["input"];
  type WritePlanInput = Parameters<typeof writePlan>[0]["input"];
  return {
    save: async (input: SaveInput) =>
      reported(`Could not save the ${input.kind}`, await save({ environmentId, input })),
    remove: async (input: DeleteInput) =>
      reported(`Could not delete the ${input.kind}`, await remove({ environmentId, input })),
    writePlan: async (input: WritePlanInput) =>
      reported("Could not save the plan", await writePlan({ environmentId, input })),
  };
}

export type KnowledgeCommands = ReturnType<typeof useKnowledgeCommands>;

/** What every tab of the panel needs from it. */
export interface KnowledgeTabProps {
  readonly projectId: ProjectId;
  readonly threadRef: ScopedThreadRef;
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
  /** False for sessions that may read threads but not change them. */
  readonly canEdit: boolean;
  readonly commands: KnowledgeCommands;
  /** A search is narrowing the list, so an empty list is "no matches", not "nothing yet". */
  readonly filtered: boolean;
}
