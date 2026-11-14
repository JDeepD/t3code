# T3 Code fork

A personal fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) that adds features
borrowed from OpenChamber. It runs as a second T3 Code environment next to the official app, with
its own data, and stays compatible with the App Store iOS and Android apps.

## Build

Requirements: [Vite+](https://viteplus.dev/guide/) (`curl -fsSL https://vite.plus | bash`) and
Node 26 first on `PATH` (the repo pins `engines.node`; here that is Homebrew's
`/opt/homebrew/opt/node/bin`).

```sh
vp i
vp run --filter t3 build   # builds apps/web, then bundles it into apps/server/dist
```

The result is `apps/server/dist/bin.mjs`, the fork's `t3` CLI. The global `t3` on `PATH` is the
official install, so always call the fork's build explicitly.

## Run

The fork keeps its state in `~/.t3-fork` and listens on port 3873, so it never touches the official
app's `~/.t3` or port 3773. Tailscale HTTPS uses port 8443, next to the official app's mapping on 443.

```sh
cd ~
node ~/Projects/t3code/apps/server/dist/bin.mjs serve \
  --base-dir ~/.t3-fork --port 3873 \
  --tailscale-serve --tailscale-serve-port 8443 --no-browser
```

The web client is then at `https://<machine>.<tailnet>.ts.net:8443/` (tailnet only).

### Pair a device

With the server running, mint a one-time link through the tailnet:

```sh
node ~/Projects/t3code/apps/server/dist/bin.mjs pair \
  --base-dir ~/.t3-fork --tailscale --tailscale-serve-port 8443 --ttl 30m --label "iPhone (fork)"
```

Scan the QR code, or paste the pairing URL into **Add environment** in the mobile app.

### Seed data

To refresh `~/.t3-fork` from a pruned read-only snapshot of the official app's data (server
stopped first; drops scheduled tasks, auth sessions and environment links, so you must pair again):

```sh
node apps/server/scripts/migrate-dev-db.ts --base-dir ~/.t3-fork
```

### Remove the Tailscale mapping

```sh
tailscale serve --https=8443 --set-path=/ off
```

## Merge upstream

```sh
git remote add upstream https://github.com/pingdotgg/t3code.git   # once
git fetch upstream
git merge upstream/main
```

Fork code lives in new files and folders. Fork data uses its own SQLite file, never the upstream
migration chain, so merges should only conflict at small hook-in points.

## Fork features

### By the way… (web and desktop)

Select assistant text, choose **By the way…**, and ask a side question in an overlay above the
composer. The first message quotes the selection; the reply and follow-ups stay in a normal side
chat, so the main thread is untouched. **Open in panel** moves it to the side chat tab; closing the
overlay keeps the side chat. Offered wherever side chats are (the server's `sideChats` capability).

- `apps/web/src/components/chat/btw/`: overlay, in-memory store, prompt logic and tests
- Hook-ins: `AssistantSelectionToolbar.tsx` (Cite | By the way… group), `MessagesTimeline.tsx`
  (passes `onAskByTheWay`), `ChatView.tsx` (offers it and mounts the overlay), `useSideChat.ts`
  (`openInBackground` starts a side chat without opening its tab)

### Notes, todos and plans (web and desktop)

A per-project panel in the thread's right panel (the **+** menu → **Notes, todos and plans**, or
the command palette). **Add to notes** on a text selection or under a reply saves it as a note that
links back to the chat. Todos can be reordered and grouped by plan. A plan is a markdown file that
agents can read and edit with their normal file tools; an edit on disk shows up in the panel, and
the panel will not overwrite a newer copy without asking. **Plan this**, **Improve plan** and
**Implement plan** put a prompt in the composer (Phase 3 turns these into magic prompts).

The server advertises the `knowledge` capability. The UI is hidden on a server without it, such as
upstream, and the mobile apps ignore it.

Data lives in the T3 home's state folder (`~/.t3-fork/userdata/fork/`). Back up that folder:

- `knowledge.sqlite`: notes, todos and plan metadata, with its own `fork_schema_version` table. To
  change the schema, append an entry to `SCHEMA_MIGRATIONS`; never edit a shipped one.
- `plans/<projectId>/<slug>.md`: the plan files.

Files:

- `packages/contracts/src/knowledge.ts`: schemas and errors. Hook-ins: `rpc.ts` (five
  `knowledge.*` methods), `environment.ts` (capability), `clientRpcPermissions.ts` (write scopes)
- `apps/server/src/knowledge/KnowledgeStore.ts`: the service and its tests. Hook-ins: `ws.ts`
  (handlers and layer), `RpcAuthorization.ts`, `RpcInstrumentation.ts`, `ServerEnvironment.ts`
- `packages/client-runtime/src/state/knowledge.ts` and `apps/web/src/state/knowledge.ts`: atoms.
  Hook-in: `rpc/client.ts` (stream tag)
- `apps/web/src/components/knowledge/`: the panel, its tabs, actions and logic tests. Hook-ins:
  `rightPanelStore.ts` and `closedViewStore.ts` (the `knowledge` panel kind), `RightPanelTabs.tsx`,
  `RightPanelSurfaceContent.tsx`, `CommandPalette.tsx`, `ChatView.tsx`,
  `AssistantSelectionToolbar.tsx`, `MessagesTimeline.tsx`, `timelineRowContext.ts`,
  `TimelineAssistantRows.tsx`

Not built: agent tools for listing and adding notes and todos. They would need a toolkit under
`apps/server/src/mcp/toolkits/`, registration and access modes in `McpHttpServer.ts` and
`McpToolExposure.ts`, a setting to turn them on, and eval cases for the tool descriptions
(`evals/README.md`). `KnowledgeStore.list` and `save` are the service methods they would call.
Todo dependencies (`dependsOn`) are stored and validated but have no UI yet.
