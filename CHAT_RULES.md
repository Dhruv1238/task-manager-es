# Firestore Rules — Per-Project Chat

Copy these rule blocks into the Firebase Console (Firestore → Rules) before enabling the chat feature.
They live in this repo for reviewability; the Console is the source of truth for deployment.

## What these rules enforce

- **Read & send messages** on `projects/{id}/chat/{msgId}`: super admin, OR project owner, OR member of any team whose id is in `project.accessKeys`.
- **Edit a message**: same gate as send, plus `authorId == request.auth.uid` (you can only edit your own message).
- **Delete a message**: nobody. Deletion is out of v1 scope; the rule keeps `allow delete: if false` so nothing ever leaves the store.
- **Update `projects/{id}.chatLastMessageAt`** by any chat-eligible viewer: allowed for that single field via `affectedKeys().hasOnly(['chatLastMessageAt'])`. The existing project-update rules for all other fields are untouched.
- **Update `users/{uid}.chatLastReadAt`** by the same user: allowed by the existing self-update rule.
- **Server-side validation** on create/update: `text` is a string ≤ 5000 chars; `authorId` and `createdAt` are immutable; `serverUpdatedAt == request.time`.

## Required helpers (place near the top of the rules file)

```
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

function validNewMessage() {
  return request.resource.data.authorId == request.auth.uid
      && request.resource.data.createdAt == request.time
      && request.resource.data.serverUpdatedAt == request.time
      && request.resource.data.text is string
      && request.resource.data.text.size() <= 5000;
}

function validEdit() {
  return request.resource.data.authorId == resource.data.authorId           // immutable
      && request.resource.data.createdAt == resource.data.createdAt         // immutable
      && request.resource.data.serverUpdatedAt == request.time
      && request.resource.data.text is string
      && request.resource.data.text.size() <= 5000;
}
```

## Chat subcollection rule

```
match /projects/{projectId}/chat/{messageId} {
  allow read, create: if request.auth != null
                      && chatEnabled()
                      && hasProjectAccess(projectId)
                      && (request.method == 'get' || request.method == 'list' || validNewMessage());

  allow update: if request.auth != null
                && chatEnabled()
                && hasProjectAccess(projectId)
                && request.auth.uid == resource.data.authorId
                && validEdit();

  allow delete: if false;   // v1: no deletes (and we never want a hard wipe)
}
```

## Project doc — chat-eligible viewers can bump `chatLastMessageAt`

Add this branch to the existing `match /projects/{projectId}` `allow update` rule (keep the existing rule as-is for all other update paths):

```
match /projects/{projectId} {
  allow update: if /* existing project update rule, unchanged */
    || (request.auth != null
        && hasProjectAccess(projectId)
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['chatLastMessageAt']));
}
```

## User doc — self-update for `chatLastReadAt`

The user already owns their own doc; if the existing rule doesn't already allow self-update, add:

```
match /users/{uid} {
  allow update: if request.auth.uid == uid;
}
```

Map-key updates via dot-notation (`chatLastReadAt.{projectId} = serverTimestamp()`) work under the same rule — Firestore evaluates the merge against the existing doc.

## Super admin chat access (explicit)

`hasProjectAccess()` returns `true` for super admins regardless of `accessKeys` membership, so super admins can read AND send messages on every project. This mirrors the client-side `canViewProjectChat` flag in `src/hooks/usePermissions.ts`.
