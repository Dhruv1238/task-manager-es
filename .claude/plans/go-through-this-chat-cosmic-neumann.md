# Per-Project Chat — Implementation Plan

## Context

Add a per-project chat panel that lives at `projects/{id}/chat/{msgId}` and feels native to the existing app (Tailwind v4 + design tokens, [persistent multi-tab Firestore cache](src/lib/firebase.ts) already on). The hard requirement is cost discipline: returning users must render history with **zero reads**, listeners must fetch only deltas since this device last synced, and unread badges must piggyback on documents already in memory. Chat is gated behind `AppConfig.features.chat` (toggled from [AppConfigPage](src/pages/AppConfigPage.tsx)) and project-membership permissions.

The spec document ([CHAT_FEATURE.md](CHAT_FEATURE.md)) anchors the design philosophy; this plan reconciles it with the actual codebase.

**Confirmed decisions (from clarifying questions):**
- Keep `AppConfig.features.chat` as a flat `boolean`. Existing `useChatEnabled()` hook, the toggle in [AppConfigPage](src/pages/AppConfigPage.tsx), and the Navbar reference all stay untouched. Expand to nested only when DMs / task-chat actually arrive (out of v1 scope).
- Ship all four phases as v1 (layout shell → read path → write path → polish).
- Firestore rules are delivered as a new `CHAT_RULES.md` document at the repo root. You will copy them into the Firebase Console manually.
- **Super admins can read AND send/edit chat messages in every project**, regardless of `accessKeys` membership. Enforced in rules and mirrored client-side.
- **No delete (or soft-delete) feature in v1.** No hover-menu delete, no `deleteMessage` mutation, no `deletedAt` field, no moderation surface. Authors can edit; that's it. Hard-delete via rules stays disallowed (`allow delete: if false`) so nothing ever leaves the store.

---

## What already exists (reuse, don't rebuild)

| Need | Existing | Notes |
|---|---|---|
| Persistent client cache | [src/lib/firebase.ts:24-30](src/lib/firebase.ts#L24-L30) | `persistentLocalCache` + `persistentMultipleTabManager` — the whole cache-first strategy plugs straight into this |
| Feature flag | [src/contexts/AppConfigContext.tsx:187-189](src/contexts/AppConfigContext.tsx#L187-L189) | `useChatEnabled()` already exists; admin UI toggle live at [AppConfigPage](src/pages/AppConfigPage.tsx) |
| Auth / current user | [src/contexts/AuthContext.tsx](src/contexts/AuthContext.tsx) | `useAuth() → { user, profile }` where `profile` is the `User` doc |
| Project membership check | [src/hooks/usePermissions.ts](src/hooks/usePermissions.ts) | Returns `isSuperAdmin`, `isProjectOwner`, `isTeamMember`, also exposes `project` for `accessKeys` check |
| `accessKeys` visibility array | [src/lib/firestore.ts](src/lib/firestore.ts) (~line 384) | Computed as `[ownerId, ...teamIds]` on every project write — used for the projects-list `array-contains-any` query. Already includes everything we need for the membership predicate. |
| Side-panel pattern | [src/components/tender/StageHistorySidePanel.tsx](src/components/tender/StageHistorySidePanel.tsx) | `createPortal` to body, fixed positioning, backdrop, Escape close, `max-w-md` (380px equivalent), body scroll lock. Mirror this exactly for the chat panel. |
| Composer textarea styling | [src/components/tasks/CommentsSection.tsx:130](src/components/tasks/CommentsSection.tsx#L130) | Token-styled textarea pattern (`bg-fill-2`, `focus:ring-brand-ring`, etc.) — reuse |
| Avatar | [src/pages/ProjectDetail.tsx:34-44](src/pages/ProjectDetail.tsx#L34-L44) | Inline `<Avatar user size>` with `bg-brand-gradient-br` ring — extract to `src/components/ui/Avatar.tsx` so chat (and others) can import it without copy-paste |
| Relative time formatter | [src/components/tender/StageHistorySidePanel.tsx:27-39](src/components/tender/StageHistorySidePanel.tsx#L27-L39) | `fmtRelative(ts)` — extract to `src/lib/formatTime.ts` so chat can reuse without copy-paste |
| Dropdown for hover menu | [src/components/ui/Dropdown.tsx](src/components/ui/Dropdown.tsx) | Use for the per-message edit menu |
| File upload | [src/lib/uploadAsset.ts](src/lib/uploadAsset.ts) | `uploadAsset(file) → { url, key, contentType, sizeBytes, fileName }` — reuse for chat attachments |
| User map (for avatars in messages) | [src/hooks/useAllUsers.ts](src/hooks/useAllUsers.ts) | Already used elsewhere; the projects pages already load this |

**No new dependencies needed.** The spec mentioned `idb` / `localforage` / `@tanstack/react-virtual` / `date-fns` — we deliberately skip all of them (see "Trade-offs" below).

---

## Data model

### Server (Firestore)

**New subcollection: `projects/{projectId}/chat/{messageId}`**

```ts
// src/types/models.ts — add at the bottom
export interface ChatMessage {
  id: string
  authorId: string
  text: string
  createdAt: Timestamp          // immutable
  serverUpdatedAt: Timestamp    // bumped on every write — drives the delta listener
  editedAt?: Timestamp
  attachments?: ChatAttachment[]
}

export interface ChatAttachment {
  url: string
  name: string
  contentType: string
  sizeBytes: number
  key?: string                  // from uploadAsset() — kept in case we ever need it
}
```

No `deletedAt` field — deletes are out of v1 scope. `serverUpdatedAt` is the linchpin: every mutation (create, edit) sets it via `serverTimestamp()`. The delta listener filters on it, so one query covers all change types.

### Project doc — denormalized `chatLastMessageAt`

Add to the existing [Project](src/types/models.ts#L100-L125) interface:

```ts
chatLastMessageAt?: Timestamp   // bumped in the same batched write as every chat mutation
```

This is the field that makes the projects-list unread dot cost zero reads (the project doc is already fetched to render the card).

### User doc — unread tracking

Add to the existing [User](src/types/models.ts#L33-L43) interface:

```ts
chatLastReadAt?: { [projectId: string]: Timestamp }
```

Written when the chat panel is open and visible, debounced once per minute per project. Read on the projects list and chat panel to compute unread.

### Client (per device) — `ChatSyncState`

The only state we manage ourselves; messages themselves live in Firestore's persistent IndexedDB cache, not duplicated.

```ts
// src/lib/chatSyncState.ts
type ChatSyncState = {
  [projectId: string]: { lastSyncedAt: number; schemaVersion: number }
}
```

**Storage: `localStorage`** (not `idb`). Rationale: this is `~30 bytes` per project — even with 10,000 projects that's 300KB, well under localStorage's 5–10MB quota. The Firestore SDK already manages the heavyweight IndexedDB cache for messages. Adding a separate IDB wrapper just to store a `{ lastSyncedAt }` map is over-engineering. Key the entry per Firebase user (`appConfig`-style serialization) so that switching users clears it cleanly on logout.

---

## The sync algorithm — single source of truth

Mounted via a custom hook used only inside `ProjectChatContext`:

```ts
// src/hooks/useChatListener.ts (sketch)
export function useChatListener(projectId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const { profile } = useAuth()

  useEffect(() => {
    if (!projectId || !profile?.uid) return
    let cancelled = false
    const msgsCol = collection(db, 'projects', projectId, 'chat')

    // (1) Render history from local cache — ZERO server reads on returning visits
    void getDocs(query(msgsCol, orderBy('createdAt', 'desc'), limit(50)), { source: 'cache' })
      .then(snap => { if (!cancelled) setMessages(snap.docs.map(toMessage).reverse()) })
      .catch(() => { /* cache miss is fine; the listener below fills history */ })

    // (2) Read per-device high-water mark for this project
    const { lastSyncedAt } = readSyncState(profile.uid, projectId)
    const cutoff = Timestamp.fromMillis(lastSyncedAt)

    // (3) Subscribe to deltas only
    const unsub = onSnapshot(
      query(msgsCol, where('serverUpdatedAt', '>', cutoff), orderBy('serverUpdatedAt', 'asc')),
      snap => {
        let maxSeen = lastSyncedAt
        const changes = snap.docChanges()
        setMessages(prev => applyChanges(prev, changes))   // dedup + sort by createdAt
        changes.forEach(c => {
          const ms = (c.doc.data().serverUpdatedAt as Timestamp).toMillis()
          if (ms > maxSeen) maxSeen = ms
        })
        if (maxSeen > lastSyncedAt) writeSyncState(profile.uid, projectId, maxSeen)
      },
      err => {
        // Permission revoked mid-session: detach + clear local cache for this project
        if (err.code === 'permission-denied') { setMessages([]); clearSyncState(profile.uid, projectId) }
      },
    )

    return () => { cancelled = true; unsub() }
  }, [projectId, profile?.uid])

  return messages
}
```

**Cache-empty + `lastSyncedAt > 0` edge case**: if `getDocs({source: 'cache'})` returns empty *and* `lastSyncedAt` is non-zero (browser evicted Firestore IDB but localStorage survived), reset `lastSyncedAt` to 0 and re-init — pays one-time history refetch instead of silently showing nothing. Cheap, rare.

### Mutations — all batch-write `chatLastMessageAt`

```ts
// src/lib/chat.ts
sendMessage(projectId, text, attachments?)
editMessage(projectId, msgId, newText)
markRead(projectId)                  // debounced once per minute, updates users/{uid}.chatLastReadAt[projectId]
```

Both `send` and `edit` are a `writeBatch` that (a) writes the message doc and (b) bumps `projects/{id}.chatLastMessageAt = serverTimestamp()`. The 2× write cost on sends is the price for free unread dots on the projects list — the right trade at this scale. `markRead` writes only `users/{uid}` and is debounced — no project-doc bump.

---

## Routing change: introduce `ProjectLayout`

Today, [src/App.tsx:35-40](src/App.tsx#L35-L40):
```tsx
<Route path="/projects/:projectId" element={<ProjectDetail />} />
<Route path="/projects/:projectId/boards" element={<ProjectBoard />} />
<Route path="/projects/:projectId/teams/:teamId" element={<TeamOnProject />} />
```

After:
```tsx
<Route path="/projects/:projectId" element={<ProjectLayout />}>
  <Route index element={<ProjectDetail />} />
  <Route path="boards" element={<ProjectBoard />} />
  <Route path="teams/:teamId" element={<TeamOnProject />} />
</Route>
```

`ProjectLayout` is thin:
- Mounts `<ProjectChatProvider projectId={...}>` so the listener attaches at the *project* level (one project switch = one re-subscribe; navigating overview ↔ board ↔ team-on-project = zero churn)
- Renders `<Outlet />` for the child page
- Renders the floating chat toggle button (top-right, fixed) and the slide-in panel
- Both gated on `useChatEnabled() && canViewProjectChat`

**Note**: the chat toggle is positioned at the layout level (fixed in a project-scoped header strip or floating in the top-right of the layout), *not* injected into each child page's header. This keeps `ProjectDetail` and `ProjectBoard` headers untouched — important for the rollout because we don't have to coordinate with their existing header buttons (Board View link, +New Task, Manage Teams).

---

## Permissions

### Who can read / send / edit (client and server mirror each other)

- **Read & send**: super admin (any project), OR project owner, OR member of any team in `project.accessKeys`
- **Edit own message**: same gate as send, restricted to `authorId == request.auth.uid`. (Super admins editing other people's messages is moderation — not in v1.)
- **Delete (any kind)**: nobody, not in v1. Rules disallow it; UI never offers it.

> **Super admin chat access (explicit)**: super admins can both **read and send messages** in every project, regardless of `accessKeys` membership. Enforced in [CHAT_RULES.md](CHAT_RULES.md) (`hasProjectAccess()` returns true for super admins) and mirrored on the client (toggle button + composer render for them everywhere).

### Client-side membership predicate

[usePermissions](src/hooks/usePermissions.ts) doesn't expose a generic "is this person allowed to use chat on this project" flag today. Add one to keep symmetry with the other contextual flags:

```ts
// src/hooks/usePermissions.ts — inside the returned object
canViewProjectChat: Boolean(
  isSuperAdmin
    || (uid && project && project.accessKeys?.includes(uid))
    || (uid && project && project.accessKeys?.some((k) => profile?.teamIds.includes(k)))
)
```

Used by `ProjectLayout` to decide whether to render the chat toggle / panel at all.

### Firestore rules — delivered as `CHAT_RULES.md` at repo root

A new file [CHAT_RULES.md](CHAT_RULES.md) at the repo root (alongside [CHAT_FEATURE.md](CHAT_FEATURE.md) and [PLATFORM_OVERVIEW.md](PLATFORM_OVERVIEW.md)) holds the rules in a copy-paste-ready format. You'll paste them into the Firebase Console manually.

Sketch of the content:

```
match /projects/{projectId}/chat/{messageId} {
  allow read, create: if chatEnabled() && hasProjectAccess(projectId)
                      && validNewMessage();
  allow update: if chatEnabled() && hasProjectAccess(projectId)
                && request.auth.uid == resource.data.authorId
                && validEdit();
  allow delete: if false;   // no delete in v1, and we never want a hard wipe
}

// Project doc — allow chat-eligible viewers to update ONLY chatLastMessageAt
match /projects/{projectId} {
  allow update: if /* existing project update rule, unchanged */
    || (hasProjectAccess(projectId)
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['chatLastMessageAt']));
}

// User doc — self-update for chatLastReadAt map merge
match /users/{uid} {
  allow update: if request.auth.uid == uid;   // existing or new — verify in console
}

function chatEnabled() {
  return get(/databases/$(database)/documents/config/appConfig).data.features.chat == true;
}

function isSuperAdmin() {
  return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.globalRole == 'super_admin';
}

function hasProjectAccess(projectId) {
  let p = get(/databases/$(database)/documents/projects/$(projectId)).data;
  let u = get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
  return isSuperAdmin()
      || request.auth.uid in p.accessKeys
      || p.accessKeys.hasAny(u.teamIds);
}

// Server-side validation
function validNewMessage() {
  return request.resource.data.authorId == request.auth.uid
      && request.resource.data.createdAt == request.time
      && request.resource.data.serverUpdatedAt == request.time
      && request.resource.data.text is string
      && request.resource.data.text.size() <= 5000;
}
function validEdit() {
  return request.resource.data.authorId == resource.data.authorId        // immutable
      && request.resource.data.createdAt == resource.data.createdAt      // immutable
      && request.resource.data.serverUpdatedAt == request.time
      && request.resource.data.text is string
      && request.resource.data.text.size() <= 5000;
}
```

**Rationale on `accessKeys`**: the project's `accessKeys` array is already `[ownerId, ...teamIds]` (written by [firestore.ts](src/lib/firestore.ts) on every project write). So `uid in accessKeys || teamIds ∩ accessKeys` is the complete membership predicate — no extra reads.

### Indexes

Both queries needed for chat are **single-field**, which Firestore auto-creates:
- `projects/{pid}/chat` ordered by `serverUpdatedAt` asc (delta listener — same field for filter + order, no composite needed)
- `projects/{pid}/chat` ordered by `createdAt` desc (history pagination)

No `firestore.indexes.json` work required.

---

## UI components

### Files to add (all under `src/components/chat/`)

| File | Responsibility |
|---|---|
| `ChatToggleButton.tsx` | Icon button in `ProjectLayout`, renders unread badge from context, opens panel. Styled to match the existing token-styled icon buttons (e.g., [ThemeToggle](src/components/ThemeToggle.tsx)). |
| `ProjectChatPanel.tsx` | Slide-in panel (clone of [StageHistorySidePanel](src/components/tender/StageHistorySidePanel.tsx) structure). Owns scroll, "new messages" pill, layout |
| `MessageList.tsx` | Plain map over messages (no virtualization — v1) with `IntersectionObserver` at the top for "load older" |
| `MessageRow.tsx` | One message. Hover-menu via [Dropdown](src/components/ui/Dropdown.tsx) shows **Edit** only (own messages). "(edited)" indicator next to timestamp when `editedAt` set. |
| `MessageComposer.tsx` | Textarea (token-styled like [CommentsSection](src/components/tasks/CommentsSection.tsx)), Enter to send / Shift+Enter for newline, attach button calling `uploadAsset()` |
| `MessageAttachments.tsx` | Inline thumb for images, filename + icon for other types (reuse [FileBadge](src/components/ui/FileBadge.tsx)) |
| `NewMessagesPill.tsx` | "↓ N new messages" pill when user scrolled up and a new message arrives |
| `UnreadDot.tsx` | Pure presentational `<span className="h-1.5 w-1.5 rounded-full bg-info-dot">` — used on projects-list cards |

### Files to add (other dirs)

| File | Responsibility |
|---|---|
| `src/layouts/ProjectLayout.tsx` | Route layout wrapper (above) |
| `src/contexts/ProjectChatContext.tsx` | Provider supplied at layout level. Exposes `{ messages, unreadCount, isPanelOpen, openPanel, closePanel, send, edit, markRead }` |
| `src/hooks/useChatListener.ts` | Sync algorithm (above) — single source of `onSnapshot` for chat |
| `src/lib/chatSyncState.ts` | `readSyncState / writeSyncState / clearAllForUser` against `localStorage` |
| `src/lib/chat.ts` | `sendMessage / editMessage / markRead`, all using `writeBatch` where applicable |
| `src/lib/formatTime.ts` | Extract `fmtRelative` from [StageHistorySidePanel](src/components/tender/StageHistorySidePanel.tsx) |
| `src/components/ui/Avatar.tsx` | Extract the inline Avatar pattern, parameterized by `user` + `size` |
| `CHAT_RULES.md` (repo root) | Copy-paste-ready Firestore rules block (above) |

### Files to modify

| File | Change |
|---|---|
| [src/App.tsx](src/App.tsx) | Nest the 3 project routes under `ProjectLayout` (above) |
| [src/types/models.ts](src/types/models.ts) | Add `ChatMessage`, `ChatAttachment`; extend `Project` with `chatLastMessageAt?`; extend `User` with `chatLastReadAt?` |
| [src/hooks/usePermissions.ts](src/hooks/usePermissions.ts) | Add `canViewProjectChat` flag (computed as shown above) |
| [src/pages/Projects.tsx](src/pages/Projects.tsx) | Add `<UnreadDot>` on each project card using `project.chatLastMessageAt` vs. `profile.chatLastReadAt?.[id]`. Zero new fetches. |
| [src/contexts/AuthContext.tsx](src/contexts/AuthContext.tsx) | On `signOut`, call `clearAllForUser(uid)` from `chatSyncState` |

---

## Trade-offs / deferrals (deliberate)

| Spec calls for | v1 ships | Why |
|---|---|---|
| `idb` or `localforage` dependency | `localStorage` | Sync state is ~30 bytes/project; localStorage is plenty and avoids a new dep |
| Virtualized message list | Plain map, paginate older on scroll-top | Chats won't reach hundreds of in-window messages at current scale. Add `@tanstack/react-virtual` only if profiling proves it's needed |
| `date-fns` for timestamps | Reuse existing `fmtRelative` (extracted from StageHistorySidePanel) | Already proven across the app |
| `features.chat.enabled` + `scopes.projectChat` nested shape | Keep existing `features.chat: boolean` | Decided. Migrate when DMs/task-chat arrive. |
| **Soft delete / "this message was deleted"** | **Skipped (no delete UI, no `deletedAt` field, rules disallow hard delete)** | **Per user direction — defer all delete semantics to a later iteration.** |
| Super admin moderation (delete any message) | Skipped (no delete in v1) | Falls out of "no delete." Super admins can still edit their own messages and chat everywhere. |
| Push notifications, mentions, reactions, threading, message search | Skipped | Explicitly out of v1 scope |
| Global unread count in top nav | Skipped | High cost, marginal UX. Per-project dot already tells you where to look. |
| Optional exact unread count on project cards | Binary `UnreadDot` only | Free + good UX. Add `getCountFromServer` later if a client asks. |

---

## Phased rollout (all four ship as v1)

**Phase 1 — Layout shell + toggle (no chat behavior yet)**
- Add `ProjectLayout`, nest the three project routes under it
- Render the chat toggle button gated by `useChatEnabled() && canViewProjectChat` (clicking opens an empty placeholder panel)
- Add `canViewProjectChat` to [usePermissions](src/hooks/usePermissions.ts)
- Verify routes still work end-to-end before adding any Firestore writes

**Phase 2 — Read path**
- Add `ChatMessage` / `ChatAttachment` types, extend `Project` + `User`
- Write [CHAT_RULES.md](CHAT_RULES.md); deploy the rules to the Firebase Console
- Implement `useChatListener` + `chatSyncState`
- Wire `ProjectChatContext`, render messages in the panel
- Unread badge on the toggle (free, client-computed)
- Test on a project where messages were manually seeded via Firebase Console
- **Gate**: Firebase Console rules deployed *before* this phase ships, otherwise the listener will permission-deny

**Phase 3 — Write path**
- `sendMessage / editMessage / markRead` in `src/lib/chat.ts`
- Composer + hover menu (edit only, on own messages) + optimistic UI
- Attachments via [uploadAsset](src/lib/uploadAsset.ts)

**Phase 4 — Polish**
- `<UnreadDot>` on the projects list (zero-read, just denormalized field comparison)
- Auto-scroll / "↓ new messages" pill
- Empty-state copy ("No messages yet — start the conversation.")
- Network-panel verification of zero-read returning visits

Each phase is independently shippable behind `features.chat: false` (the master toggle), which lets you merge incrementally without enabling chat for end users until Phase 4 is verified.

---

## Verification

End-to-end checks before declaring done (re-run after each phase that touches the path):

1. **First-ever visit** — open a project chat, network panel shows ≤ 50 reads, panel renders messages
2. **Re-open same project** — close the panel, navigate to `/projects/{id}/boards`, re-open chat → cache hit, **zero reads** in network panel for history (only the listener subscription if a new message exists)
3. **Cross-page within project** — open chat on Overview, navigate to Boards → panel stays open, no listener re-subscription
4. **Multi-day return** — manually set `localStorage` `lastSyncedAt` to 3 days ago, reload → history renders from cache, listener fetches only messages with `serverUpdatedAt > 3 days ago`
5. **Send** — type + Enter → message appears optimistically, then echoes back via listener within ~200ms with server timestamp; `projects/{id}.chatLastMessageAt` updated in Firestore Console
6. **Edit** — edit own message → "(edited)" indicator appears for all viewers within ~200ms; `editedAt` set in Firestore
7. **Non-author cannot edit** — verify the Edit affordance does not render for other people's messages (and that rules reject the call if attempted via console)
8. **Super admin reach** — as a super admin who is NOT a member of project X, the chat toggle renders, the panel opens, and `sendMessage` succeeds
9. **Unread dot on projects list** — send a message as user A on project P; user B's projects list shows the dot on P's card without any extra reads (verify via the network panel)
10. **Cross-tab** — open the same project in two tabs, send from one → second tab updates via the listener (multi-tab persistent cache handles this)
11. **Feature flag off** — flip `AppConfig.features.chat` to `false` in [AppConfigPage](src/pages/AppConfigPage.tsx) → toggle button disappears everywhere within a render
12. **Permission revoked mid-session** — manually remove user from project → listener gracefully detaches, panel hides, no console error spam
13. **Build + typecheck** — `npm run build` clean (verify after each phase)
