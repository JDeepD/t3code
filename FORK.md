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

## Desktop app

Needs a Rust toolchain (`rustup toolchain install stable`) besides the build requirements above.

```sh
vp run dist:desktop:dmg:arm64        # writes an unsigned .dmg and .zip to release/
ditto -x -k release/T3-Code-*-arm64.zip release/app
```

The official app and this one share a bundle id and, by default, a profile folder and `~/.t3`.
Launch the fork's app with its own home, profile and port so both can run at once, and with
updates off so it is not replaced by an upstream release:

```sh
T3CODE_HOME=~/.t3-fork T3CODE_DESKTOP_PROFILE=t3code-fork T3CODE_PORT=3873 \
  T3CODE_DISABLE_AUTO_UPDATE=1 \
  "release/app/T3 Code (Beta).app/Contents/MacOS/T3 Code (Beta)"
```

`scripts/fork/install-app.sh` copies the built app to `/Applications/T3 Code Plus.app` and writes
those four settings into its `Info.plist` (`LSEnvironment`), so it opens by double-click. Run it
after each desktop build, with the fork app closed. Never double-click the copy in `release/`: it
has no settings and would open the official app's data.

`scripts/fork/launch-desktop.sh` runs that for you and leaves the app open after the terminal
closes. `scripts/fork/refresh-from-nightly.sh` closes the fork app, re-copies the official app's
chats (see Seed data) and reopens it. Run it from your own terminal: the copy skips a chat whose
agent is working or has background tasks running.

`T3CODE_DESKTOP_PROFILE` is a fork addition (`apps/desktop/src/app/DesktopUserData.ts`): it names
the profile folder under `~/Library/Application Support`. Without it the app uses `t3code-v2`, the
official app's profile, and quits at once while that app is running. Do not run the CLI server on
`~/.t3-fork` at the same time as the desktop app.

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
**Implement plan** put the matching magic prompt in the composer.

The server advertises the `knowledge` capability. The UI is hidden on a server without it, such as
upstream, and the mobile apps ignore it.

Its data is in the fork's state folder; see [Fork data](#fork-data).

Files:

- `packages/contracts/src/knowledge.ts`: schemas and errors. Hook-ins: `rpc.ts` (five
  `knowledge.*` methods), `environment.ts` (capability), `clientRpcPermissions.ts` (write scopes)
- `apps/server/src/knowledge/KnowledgeStore.ts`: the service and its tests, on
  `apps/server/src/fork/ForkDatabase.ts`. Hook-ins: `ws.ts` (handlers and layers),
  `RpcAuthorization.ts`, `RpcInstrumentation.ts`, `ServerEnvironment.ts`
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

### Magic prompts (web and desktop)

Editable prompt templates in **Settings → Magic prompts**. Each has a visible prompt (your
message) and instructions (read only by the agent), with `{{placeholder}}` substitution. The
built-in text can be overridden globally and per project; the page's scope picker chooses which.
A project override wins over the global one, one part at a time.

- **Session commands:** `/catch-up`, `/summary`, `/debug`, `/weigh`, `/tour`, `/review` and
  `/resolve-conflicts` at the start of a message insert the template. A provider command or skill
  of the same name wins. A template with a placeholder leaves the composer ready for you to type
  the missing part; there is no separate form.
- **Planning:** **Plan this**, **Improve plan** and **Implement plan** in the notes panel.
- **Git:** the `git.commit` and `git.pr` instructions are added after the writing style chosen in
  Settings → Source control, so both apply. They are empty by default, which keeps generated
  commits and pull requests the same as upstream until you edit them.

Instructions travel as a context record of kind `instructions`, referenced by a chip in the
message. Deleting the chip drops them. The agent receives them in the message's context block;
the mobile apps show the chip as its label. They are attached on a normal send only, not when
editing a queued message or sending to several models at once.

Not built: a `memory.tidy` template (it needs the agent tools above), and using `git.conflict`
for the pull request **Resolve conflicts** button, which keeps upstream's prompt. T3 Code has no
list of locally conflicted files, so `{{files}}` is only filled if you type it.

Files:

- `packages/contracts/src/magicPrompts.ts`: schemas and placeholder helpers. Hook-ins: `rpc.ts`
  (three `magicPrompts.*` methods), `environment.ts`, `clientRpcPermissions.ts`
- `apps/server/src/magicPrompts/`: `builtinTemplates.ts` (the default text) and
  `MagicPromptStore.ts`. Hook-ins: `ws.ts`, `server.ts` and `git/GitManager.ts`
  (`withMagicPrompt`), plus the auth and metrics tables
- `packages/client-runtime/src/state/magicPrompts.ts`, `apps/web/src/state/magicPrompts.ts`
- `apps/web/src/components/magicPrompts/`: settings page, slash-command items, the instructions
  channel and tests. Hook-ins: `routes/_chat.settings.magic-prompts.tsx`, `settingsSearch.ts`,
  `useAvailableSettingsSearchItems.ts`, `SettingsSidebarNav.tsx`, `ComposerCommandMenu.tsx`,
  `useComposerMenuItems.ts`, `ChatComposer.tsx`, `useComposerSend.ts`,
  `UserMessageContextChips.tsx`, `composerContextPresentation.tsx`

## Fork data

Everything the fork stores is in the T3 home's state folder, `~/.t3-fork/userdata/fork/`. Back up
that folder with the server stopped:

- `fork.sqlite`: notes, todos, plan metadata and magic prompt overrides, with its own
  `fork_schema_version` table. To change the schema, append an entry to `SCHEMA_MIGRATIONS` in
  `ForkDatabase.ts`; never edit a shipped one.
- `plans/<projectId>/<slug>.md`: the plan files.

## Known limits

- None of the fork features appear in the mobile apps or on `app.t3.codes`, which serve upstream
  code. Use the fork's own web app or desktop build.
- Against an unmodified upstream server, the fork's web client hides all of them.
