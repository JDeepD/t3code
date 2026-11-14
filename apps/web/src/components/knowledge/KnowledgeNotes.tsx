import {
  KNOWLEDGE_NOTE_MAX_CHARS,
  type KnowledgeNote,
  type KnowledgeSource,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { CopyIcon, PencilIcon, PinIcon, PinOffIcon, SendIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { usePrimarySettings } from "~/hooks/useSettings";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { assistantCitationNavigation } from "~/lib/assistantCitationNavigation";
import { useQuietThreadShell } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Textarea } from "../ui/textarea";
import { insertIntoComposer, type KnowledgeTabProps } from "./knowledgeActions";
import { KnowledgeIconAction } from "./KnowledgeIconAction";

/** "From chat · 3:40 PM", opening the thread and, when the note kept its selection, scrolling to it. */
function NoteSourceLink(props: {
  readonly source: KnowledgeSource;
  readonly threadRef: ScopedThreadRef;
  readonly createdAt: string;
}) {
  const navigate = useNavigate();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const sourceRef = scopeThreadRef(props.threadRef.environmentId, props.source.threadId);
  const sourceThread = useQuietThreadShell(sourceRef);
  const { citation } = props.source;
  const open = () => {
    void navigate(
      citation === undefined
        ? { to: "/$environmentId/$threadId", params: buildThreadRouteParams(sourceRef) }
        : assistantCitationNavigation(citation, sourceThread),
    );
  };
  return (
    <Button type="button" size="xs" variant="link" onClick={open}>
      From chat · {formatDayAwareTimestamp(props.createdAt, timestampFormat)}
    </Button>
  );
}

function NoteEditor(props: {
  readonly initial: string;
  readonly submitLabel: string;
  readonly onSubmit: (body: string) => Promise<boolean>;
  readonly onCancel?: () => void;
}) {
  const [body, setBody] = useState(props.initial);
  const [saving, setSaving] = useState(false);
  const trimmed = body.trim();
  const submit = async () => {
    if (trimmed === "" || saving) return;
    setSaving(true);
    const saved = await props.onSubmit(trimmed);
    setSaving(false);
    if (saved && props.onCancel === undefined) setBody("");
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        size="sm"
        placeholder="Write a note in markdown…"
        aria-label="Note text"
        maxLength={KNOWLEDGE_NOTE_MAX_CHARS}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="flex items-center justify-end gap-1.5">
        <span className="mr-auto text-2xs text-muted-foreground tabular-nums">
          {body.length}/{KNOWLEDGE_NOTE_MAX_CHARS}
        </span>
        {props.onCancel ? (
          <Button type="button" size="xs" variant="ghost" onClick={props.onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={trimmed === "" || saving}
          onClick={() => void submit()}
        >
          {props.submitLabel}
        </Button>
      </div>
    </div>
  );
}

function NoteCard(props: { readonly note: KnowledgeNote } & KnowledgeTabProps) {
  const { note, commands, canEdit } = props;
  const [editing, setEditing] = useState(false);
  const save = async (body: string) => {
    const result = await commands.save({
      kind: "note",
      id: note.id,
      projectId: note.projectId,
      body,
      expectedUpdatedAt: note.updatedAt,
    });
    if (result._tag === "Success") setEditing(false);
    return result._tag === "Success";
  };
  return (
    <li className="rounded-lg border border-border/60 bg-card/40 p-2.5">
      {editing ? (
        <NoteEditor
          initial={note.body}
          submitLabel="Save"
          onSubmit={save}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="min-w-0 text-sm">
            <ChatMarkdown text={note.body} cwd={undefined} headingLevelOffset={3} />
          </div>
          <div className="mt-1.5 flex items-center gap-0.5">
            <div className="mr-auto min-w-0 truncate text-2xs text-muted-foreground">
              {note.source ? (
                <NoteSourceLink
                  source={note.source}
                  threadRef={props.threadRef}
                  createdAt={note.createdAt}
                />
              ) : null}
            </div>
            {canEdit ? (
              <KnowledgeIconAction
                label={note.pinned ? "Unpin" : "Pin to top"}
                onClick={() =>
                  void commands.save({
                    kind: "note",
                    id: note.id,
                    projectId: note.projectId,
                    pinned: !note.pinned,
                  })
                }
              >
                {note.pinned ? <PinOffIcon className="size-3" /> : <PinIcon className="size-3" />}
              </KnowledgeIconAction>
            ) : null}
            {canEdit ? (
              <KnowledgeIconAction label="Edit" onClick={() => setEditing(true)}>
                <PencilIcon className="size-3" />
              </KnowledgeIconAction>
            ) : null}
            <KnowledgeIconAction label="Copy" onClick={() => void writeTextToClipboard(note.body)}>
              <CopyIcon className="size-3" />
            </KnowledgeIconAction>
            <KnowledgeIconAction
              label="Send to chat"
              onClick={() => insertIntoComposer(props.composerDraftTarget, note.body)}
            >
              <SendIcon className="size-3" />
            </KnowledgeIconAction>
            {canEdit ? (
              <KnowledgeIconAction
                label="Delete"
                destructive
                onClick={() => void commands.remove({ kind: "note", id: note.id })}
              >
                <Trash2Icon className="size-3" />
              </KnowledgeIconAction>
            ) : null}
          </div>
        </>
      )}
    </li>
  );
}

export function KnowledgeNotes(
  props: { readonly notes: ReadonlyArray<KnowledgeNote> } & KnowledgeTabProps,
) {
  const { notes, ...shared } = props;
  const create = async (body: string) => {
    const result = await shared.commands.save({ kind: "note", projectId: shared.projectId, body });
    return result._tag === "Success";
  };
  return (
    <ScrollArea scrollFade className="min-h-0 flex-1">
      <div className="flex flex-col gap-2 p-2">
        {shared.canEdit ? <NoteEditor initial="" submitLabel="Add note" onSubmit={create} /> : null}
        {notes.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            {shared.filtered
              ? "No notes match your search."
              : "No notes yet. Select text in a reply and choose Add to notes."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((note) => (
              <NoteCard key={note.id} note={note} {...shared} />
            ))}
          </ul>
        )}
      </div>
    </ScrollArea>
  );
}
