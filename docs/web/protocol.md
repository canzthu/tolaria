# Tolaria remote protocol, version 1.7

The HTTP protocol between a Tolaria client and a server that hosts one vault as a git repository. It is written so that anyone can implement a compatible server (self-hosting) or client. The reference implementation is `apps/server`; the wire types are in `packages/protocol/src/index.ts` and are the source of truth when this document and the code disagree.

Status: spikes S3 (TOL-5) and S4 (TOL-8). The file API and the collaboration channel below are implemented and tested. Version 1.1 added the collaboration channel; it changed nothing in the file API of 1.0. Version 1.2 added the change feed (`GET /v1/changes`); it changed nothing in 1.1's file or collaboration API. Version 1.3 added remote image import (`POST /v1/attachments/imports`) and the `remote_unavailable` error code; it changed nothing else. Version 1.4 added the wikilink rewrite of `POST /v1/rename` (`rewriteLinks`, `title`, `oldTitle`); a rename without them works as in 1.0. Version 1.5 changed which side of a collaboration fork becomes the conflict copy: the live document keeps its edits and `meta.conflictCopy` names the copy of the incoming file (see "What the server does with a document"); nothing else changed. Version 1.6 added rate limits and websocket limits: the `rate_limited` error code with `Retry-After`, the `429` refusal of a websocket upgrade, and the `4408` close code of an idle connection (see "Limits"); a client within the limits sees no change. Version 1.7 added folder renames (`POST /v1/folders/rename`, capability `folders.rename`); nothing else changed.

## Design rules

- **Files stay files.** A vault is a git repository of markdown notes and attachments. The server never stores a note in a form git and the desktop app cannot read.
- **Every file has a revision.** The `etag` of a file is its git blob id (`sha1("blob <size>\0" + bytes)`), so a client or another server can compute it without asking.
- **A write states what it was based on.** The server never overwrites a version the client has not seen unless the client asks for exactly that.
- **Nothing is lost.** When a write cannot take the path it asked for, its bytes are saved next to it as a conflict copy.
- **Versioned and additive.** Routes carry the major version, responses carry the full version, and features are announced as capabilities. Collaboration adds routes and capabilities; it changes none of the file API.

## Versioning and negotiation

| Mechanism | Rule |
|---|---|
| Route prefix | `/v1`. A different major is a different prefix and a different protocol. |
| `Tolaria-Protocol-Version` response header | Sent on every response, for example `1.1`. |
| `Tolaria-Protocol-Version` request header | Optional. If present and its major is not the server's, the server answers `400 unsupported_protocol_version`. |
| Minor versions | Only add: new routes, new optional fields, new capabilities, new error codes. Clients must ignore fields and capabilities they do not know. |
| Capabilities | `GET /v1/vault` lists what this server does. Clients check a capability before using a feature. |

Capabilities:

| Capability | Meaning |
|---|---|
| `files.read`, `files.write`, `files.rename`, `files.delete` | The file routes below. |
| `files.conflict-copy` | A stale write is saved as a conflict copy instead of being rejected. |
| `search.text` | `GET /v1/search`. |
| `sync.git` | The vault is backed by a git remote; `pushed` and `POST /v1/sync` are meaningful. |
| `docs.ids` | Notes carry a stable `docId`. |
| `entries.index` | `GET /v1/entries` provides a parsed vault index (since 1.2). |
| `entries.delta` | `GET /v1/entries?since=<head>` provides incremental updates (since 1.2). |
| `changes.feed` | `GET /v1/changes` Server-Sent Events stream of vault changes (since 1.2). |
| `attachments.import` | `POST /v1/attachments/imports` downloads a public image into `attachments/` (since 1.3). |
| `files.rename.links` | `POST /v1/rename` rewrites the wikilinks to the renamed note on request (since 1.4). |
| `folders.rename` | `POST /v1/folders/rename` moves every file of a folder in one commit (since 1.7). |
| `collab.yjs`, `collab.awareness` | The collaboration channel is served (since 1.1). |
| `collab.tickets` | `POST /v1/collab/tickets` issues websocket tickets (since 1.1). |

## Authentication and transport

- Every route except `GET /healthz` requires `Authorization: Bearer <token>`. A missing or wrong token gets `401 unauthorized` with `WWW-Authenticate: Bearer`.
- The reference server reads the token from `TOLARIA_SERVER_TOKEN` and does not start without it. It speaks plain HTTP and binds `127.0.0.1`; anything else needs an explicit opt-in and a TLS-terminating proxy in front.
- One token gives full access to the one vault. Accounts, per-user identity and permissions are outside this protocol version.
- `GET /healthz` answers `200 {"status":"ok"}` and reveals nothing about the vault.

## Limits

Since 1.6 the server limits what one account (one token) may use, so one client cannot exhaust the vault's container. Front-line limits at the edge are separate and not part of this protocol.

| Limit | Default | When exceeded |
|---|---|---|
| Requests, token bucket per account | 50 per second, bursts of 500 | `429 rate_limited` with `Retry-After` (whole seconds). Every route but `GET /healthz` counts, before authentication. Every websocket upgrade counts too: an admitted one to the account, whether it came with the token or a ticket; a refused one (`401`, `404`) to the bucket an HTTP request with the same `Authorization` header would use. Beyond the budget the upgrade is refused with `429` and `Retry-After` instead. Requests and refused upgrades without the token share a bucket of their own, so they never use the account's. |
| Open websockets per account | 128 | The upgrade is refused with `429`, without `Retry-After`: a place frees when one of the account's sockets closes. |
| Open websockets per document | 32 | As above. |
| Websocket message size | the body limit, at most 16 MiB | Closed with `1009`. |
| Websocket idle timeout | 60 s | The server pings a socket every timeout; one that sent nothing since the last ping, not even a pong, is closed with `4408`. Browsers answer pings themselves, so this only closes a dead or stuck peer. |

The reference server's settings are in `apps/server/README.md`. A client should back off on `429` and on a refused or closed websocket; the collaboration provider in `packages/collab-client` reconnects with a doubling delay.

## Paths

A path is relative to the vault root, uses `/`, and is percent-encoded in URLs (`/v1/files/my%20notes/caf%C3%A9.md`). The server answers `400 invalid_path` for:

- an empty path, an absolute path, an empty segment, or a `.` or `..` segment;
- any segment starting with `.git` in any letter case (`.git/`, `.gitignore`, `.gitattributes`);
- a backslash or a control character;
- more than 1024 bytes of UTF-8.

Symbolic links in the repository are not listed and are checked out as plain files.

## Errors

Every error has the same JSON body. `code` is stable; `message` is for people.

```json
{ "error": { "code": "precondition_failed", "message": "welcome.md changed since the given revision", "details": { "current": { "path": "welcome.md", "etag": "e7b4…" } } } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_path` | The path breaks the rules above or is not valid percent-encoding. |
| 400 | `invalid_request` | A malformed body or query parameter. |
| 400 | `unsupported_protocol_version` | The client asked for another major version. |
| 401 | `unauthorized` | Missing or wrong bearer token. |
| 404 | `not_found` | No such file, or no such route. |
| 405 | `method_not_allowed` | The route exists but not for this method. `Allow` lists the supported ones. |
| 409 | `destination_exists` | A rename target exists, or the path runs through a file or names a folder. |
| 412 | `precondition_failed` | Rename or delete with an `etag` that is no longer current. `details.current` has the current one. |
| 413 | `payload_too_large` | The body exceeds the server's limit (25 MB by default). |
| 428 | `precondition_required` | A write or delete without the header that says what it was based on. |
| 429 | `rate_limited` | The account sent more requests than its limit (since 1.6). `Retry-After` and `details.retryAfterSeconds` give the seconds to wait. See "Limits". |
| 500 | `internal` | Unexpected failure. The cause is logged, not returned. |
| 426 | `upgrade_required` | A plain HTTP request to the websocket route of the collaboration channel. |
| 501 | `not_implemented` | The collaboration channel on a server that does not serve it. |
| 502 | `remote_unavailable` | A remote image import could not be downloaded: the host failed, answered an error, redirected too often or took too long (since 1.3). |

A write that ends in a conflict copy is not an error body: see `PUT` below.

## Routes

### `GET /v1/vault`

```json
{
  "protocolVersion": "1.7",
  "capabilities": ["files.read", "files.write", "files.rename", "files.delete", "files.conflict-copy", "search.text", "sync.git", "docs.ids", "entries.index", "entries.delta", "changes.feed", "attachments.import", "files.rename.links", "folders.rename", "collab.yjs", "collab.awareness", "collab.tickets"],
  "vault": { "name": "my-vault", "branch": "main", "head": "eea2db93a391d110c4707fa1f6c6078c2f39c1ca" },
  "collab": { "available": true, "path": "/v1/collab/docs", "docFormat": "tolaria.blocknote/1", "blocksFragment": "blocks", "frontmatterField": "frontmatter", "metaMap": "meta" }
}
```

### `GET /v1/files[?prefix=<path prefix>]`

Lists every tracked file at the server's current commit.

```json
{
  "head": "eea2db93a391d110c4707fa1f6c6078c2f39c1ca",
  "files": [
    { "path": "projects/heron.md", "size": 106, "etag": "7b8f92b1420404a572d7da3665fe7d969127e438", "docId": "42862532-a9e7-437f-9e73-86d32c07ff56" },
    { "path": "attachments/pixel.png", "size": 70, "etag": "2f6d…" }
  ]
}
```

`docId` is present for notes (`.md`) only. The listing does not contact the git remote; call `POST /v1/sync` first to pick up pushes from other devices.

### `GET /v1/files/<path>`

Returns the bytes of the file.

| Response header | Value |
|---|---|
| `ETag` | `"<etag>"` |
| `Content-Type` | `text/markdown; charset=utf-8` for notes, `application/octet-stream` otherwise |
| `Tolaria-Doc-Id` | The note's `docId` (notes only) |

`If-None-Match: "<etag>"` gets `304` with no body when the client's copy is current.

### `PUT /v1/files/<path>`

The body is the complete new content of the file, as raw bytes. Exactly one precondition is required:

| Request header | Meaning |
|---|---|
| `If-Match: "<etag>"` | "I edited this revision." The normal save. |
| `If-None-Match: *` | "I am creating this file." |
| `If-Match: *` | "Overwrite whatever is there." Explicit last-write-wins. |
| none | `428 precondition_required`. A missing header is more often a bug than a decision. |

The server pulls from the git remote, decides, commits once, and pushes. The response is always a write result:

```json
{ "outcome": "updated", "path": "welcome.md", "etag": "872e91ac…", "commit": "ddd19dd2…", "pushed": true, "docId": "bc1a7bc2-…" }
```

| `outcome` | Status | What happened |
|---|---|---|
| `created` | 201 | The file did not exist. |
| `updated` | 200 | The stored revision matched (or `If-Match: *`). |
| `unchanged` | 200 | The stored content is already these bytes. No commit. |
| `recreated` | 201 | The client edited a revision of a file that has since been deleted. The edit wins and the file is back. |
| `conflict` | 409 | The stored revision is not the one the client edited (or a create found the file there). The stored file is untouched; the request's bytes are saved as a conflict copy. |

On `conflict`, `path` and `etag` describe the conflict copy and `current` describes the file that kept the requested path:

```json
{
  "outcome": "conflict",
  "path": "welcome (conflict 2026-10-12 1611).md",
  "etag": "cb6f3257…",
  "commit": "e2cb1688…",
  "pushed": true,
  "docId": "91db80d4-…",
  "current": { "path": "welcome.md", "etag": "e7b4ed52…" }
}
```

- The copy is named `<name> (conflict <YYYY-MM-DD HHMM>)<ext>` in UTC, next to the original, with a counter appended (`… 1611 2`, `… 1611 3`) when the name is taken. It is an ordinary file with its own `docId`.
- `pushed: false` means the commit is safe on the server but has not reached the git remote (the remote is unreachable, or pushing kept losing a race). The server pushes it with the next write or `POST /v1/sync`.
- `Server-Timing: pull;dur=…, commit;dur=…, push;dur=…` reports the three phases in milliseconds.
- If another device pushes the same file between the server's fetch and its push, the server keeps the pushed version and returns `conflict` with a conflict copy, exactly as above.

### `DELETE /v1/files/<path>`

Requires `If-Match: "<etag>"`; `*` is not accepted. `412 precondition_failed` when the file has changed. One commit, pushed.

```json
{ "path": "welcome.md", "commit": "…", "pushed": true }
```

### `POST /v1/rename`

```json
{ "from": "people/ada.md", "to": "people/ada-lovelace.md", "ifMatch": "b5fa61f2…" }
```

`ifMatch` is optional. Missing folders of `to` are created. One commit, pushed; the note keeps its `docId`.

```json
{ "from": "people/ada.md", "path": "people/ada-lovelace.md", "etag": "b5fa61f2…", "commit": "…", "pushed": true, "docId": "ecc6f1fe-…" }
```

`404 not_found` when `from` is missing, `409 destination_exists` when `to` exists, `412 precondition_failed` when `ifMatch` is stale. The route is not `/v1/files/<path>/rename` because a vault path may itself end in `/rename`. Version 1.0 moves the file only; it does not rewrite wikilinks in other notes.

Since 1.4 the body may also carry:

| Field | Meaning |
|---|---|
| `rewriteLinks` | `true`: rewrite the wikilinks to the note in every other tracked `.md` file, in the same commit. The answer lists those files in `rewritten`. |
| `title` | The note's new title: set as its `title` property when it differs from the old title, as the desktop's title rename does. With a `title`, `to` may equal `from` (the file name already fits; only the property changes). Empty: `400 invalid_request`. |
| `oldTitle` | The title that links use, when the note's heading already changed; read from the note (H1, then `title`, then the file name) when omitted. |

```json
{ "from": "people/ada.md", "to": "people/ada-lovelace.md", "rewriteLinks": true, "title": "Ada Lovelace" }
```

```json
{ "from": "people/ada.md", "path": "people/ada-lovelace.md", "etag": "b5fa61f2…", "commit": "…", "pushed": true, "docId": "ecc6f1fe-…", "rewritten": ["projects/heron.md"] }
```

The rewrite is the desktop's (`src-tauri/src/vault/rename.rs`): links to the old title, the old path without `.md` or the old file name without `.md`, case-sensitive, become links to the new path without `.md`; an alias after `|` is kept; `[[old#heading]]` and other spellings are left alone; links in frontmatter and code are rewritten too, the renamed note's own links are not. A note open as a live document gets the same rewrite as a Yjs transaction on its `wikilink` targets and text, so edits that are not written yet are kept and its `meta.baseRevision` moves to the rewritten file. The golden cases are in `apps/server/test/fixtures/rename-golden.json` (ADR 0289).

A move to another folder is a rename whose `to` is in that folder; with `rewriteLinks` the desktop's `move_note_to_folder` rewrite applies (the same targets as above).

### `POST /v1/folders/rename` (since 1.7)

```json
{ "from": "projects", "to": "work", "rewriteLinks": true }
```

`from` and `to` are folder paths. Every tracked file under `from` moves to the same place under `to`, as one commit, pushed, with the subject `Rename folder <from> to <to>`; missing folders above `to` are created and notes keep their `docId`. With `rewriteLinks: true`, a wikilink that reaches a moved note by its path (`[[projects/alpha]]`, `[[projects/alpha|alias]]`) becomes a link to its new path (`[[work/alpha]]`) in every tracked `.md` file, the moved ones included, in the same commit. Links by title or by bare file name still resolve after the move and are left alone. Notes open as live documents follow their files and get the rewrite as a Yjs transaction, as with `POST /v1/rename`.

```json
{ "from": "projects", "path": "work", "commit": "…", "pushed": true, "moved": [ { "from": "projects/alpha.md", "to": "work/alpha.md" } ], "rewritten": ["index.md"] }
```

`rewritten` is present only with `rewriteLinks`. `404 not_found` when no tracked file is under `from`, `409 destination_exists` when something exists at `to` or a parent of `to` is a file, `400 invalid_request` when `to` is `from` or inside it. The server applies its path rules only; the reference web client also refuses a new name that Windows cannot hold (the desktop's `filename_rules.rs`) before sending anything.

### `GET /v1/search?q=<text>[&limit=<n>]`

Case-insensitive search for the literal text `q` (1 to 200 characters, one line) in tracked text files and in file paths. `limit` defaults to 50 and is capped at 200. Up to three matching lines per file, each cut at 300 characters.

```json
{ "results": [ { "path": "projects/alpha.md", "pathMatch": false, "matches": [ { "line": 3, "text": "Links to [[welcome]] and mentions the Heron." } ] } ], "truncated": false }
```

### `POST /v1/sync`

Pulls from the git remote and pushes anything pending. Clients call it to pick up changes pushed by the desktop app.

```json
{ "head": "dede5f41…", "pulled": true, "pushed": true }
```

`pulled: false` means the remote could not be reached; the server keeps serving its copy.

### `GET /v1/changes` (Server-Sent Events)

Opens a Server-Sent Events connection that emits `ChangeEvent` messages when the vault changes. Clients subscribe to track commits, pulls, and push results in real time.

Event types:

| Type | When | Fields |
|---|---|---|
| `commit` | A change was committed (write, rename, delete) | `head` (new commit SHA), `paths` (array of affected paths) |
| `pull` | A fetch integrated remote changes and HEAD moved | `head` (new commit SHA after pull) |
| `push-success` | Pending commits were pushed to the git remote | `head` (commit SHA that was pushed) |
| `push-failed` | A push to the git remote failed | `head` (commit SHA that failed to push), `error` (error message) |

Example events:

```json
data: {"type":"commit","head":"a1b2c3d4…","paths":["welcome.md"]}

data: {"type":"pull","head":"e5f6g7h8…"}

data: {"type":"push-success","head":"a1b2c3d4…"}

data: {"type":"push-failed","head":"a1b2c3d4…","error":"push to remote failed"}
```

The connection is long-lived. The server sends events as they occur; the client should reconnect on disconnect. Authentication via `Authorization: Bearer <token>` header.

### `POST /v1/attachments/imports` (since 1.3)

Has the server download an image that a pasted page points at and store it as a new file under `attachments/`, the way the desktop app imports remote images. A browser cannot fetch most images across origins, so the web client asks the server.

```json
{ "url": "https://images.example/cat.png" }
```

The answer is the `WriteResult` of the stored file (`201`, or `409` with the conflict copy when the name was taken meanwhile). Its `path` is `attachments/<unix millis>-<name>.<ext>`: the name comes from the URL's last segment, the extension from the content type. Notes link that portable path.

The URL comes from a client, so the server refuses anything that is not a public internet host (`400 invalid_request`):

- Only `http` and `https`, with no credentials in the URL.
- Every address the host resolves to must be public unicast: loopback, private, shared, link-local (which includes the cloud metadata address `169.254.169.254`), documentation, multicast and reserved IPv4, and every IPv6 address outside global unicast (loopback, unique-local, link-local, IPv4-mapped) or in its tunnelling and documentation ranges, are refused. The connection goes to the address that was checked, so the name cannot be rebound to an internal address in between.
- Every redirect is checked the same way, at most 5 of them.
- The answer must be `200` with an `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/bmp` or `image/tiff` content type. SVG is refused, as on desktop.
- At most 15 MB (`413 payload_too_large`) and 15 seconds in total (`502 remote_unavailable`).

Attachments are read and written through the file routes with the bearer token like every other file. The web client shows them through object URLs, because an `<img>` cannot send the token.

## How the server keeps git consistent

Every mutation runs alone, in this order: fetch and integrate the remote, change files, commit, push.

- **Remote ahead, nothing local pending:** fast-forward.
- **Local commits pending and the remote moved** (the server was offline, or lost a push race): the remote's history wins. The server resets to it and re-applies its pending changes file by file in one commit. A pending change to a file the remote also changed becomes a conflict copy; a pending deletion of such a file is dropped.
- **Push rejected:** integrate and retry, up to three times, then answer `pushed: false`.

The server never force-pushes and never rewrites commits that reached the remote.

## Document ids

A `docId` is a random UUID the server assigns to each note. It identifies the note's collaborative document and stays with the note through renames, including renames made on the desktop and pulled in from git (detected with git's rename detection). It is server state, kept outside the repository; nothing is written into the note. A note that is deleted, or a conflict copy, gets a fresh id. If server state is lost, ids are reassigned and documents are rebuilt from the markdown files.

## The collaboration channel (since 1.1)

A note can be opened as a live document that several clients edit at once. The markdown file stays the canonical form: the document is loaded from it, written back to it, and can always be rebuilt from it.

### Document format `tolaria.blocknote/1`

One Y.Doc per note, with three shared types:

| Name | Type | Content |
|---|---|---|
| `blocks` | `Y.XmlFragment` | The note body, in the shape BlockNote's `collaboration.fragment` binds to (y-prosemirror). |
| `frontmatter` | `Y.Text` | The frontmatter block exactly as in the file, delimiters and final newline included; empty when the note has none. |
| `meta` | `Y.Map` | `format` (`tolaria.blocknote/1`); `baseRevision`, the `etag` of the file the document is in step with; `conflictCopy`, the path of the conflict copy holding a version that could not be merged with the document (since 1.5, the incoming file's version; the document kept its edits). Written by the server only: a client's change to this map is reverted. |

`Y.Text` holding raw markdown is deliberately not the body format: BlockNote's binding needs a `Y.XmlFragment`, and a text document would lose cursors and block identity. The format string leaves room for other formats.

### `POST /v1/collab/tickets`

Browsers cannot put an `Authorization` header on a websocket. A client holding the bearer token asks for a ticket and opens the websocket with it.

```json
{ "docId": "bc1a7bc2-…", "access": "write" }
```

`access` is `write` (default) or `read`. Answer, `201`:

```json
{ "ticket": "kq3…", "expiresAt": "2026-10-12T19:04:00.000Z", "path": "/v1/collab/docs/bc1a7bc2-…", "access": "write" }
```

A ticket opens one websocket, for that document only, and expires after 60 seconds. `404 not_found` for an unknown `docId`, `400 invalid_request` for another `access`, `501 not_implemented` when the channel is not served.

### `GET /v1/collab/docs/<docId>` (websocket)

Authentication, one of:

- `?ticket=<ticket>` from the route above;
- `Authorization: Bearer <token>` on the upgrade request, for clients that can send headers. It gives `write` access.

The upgrade is refused with `401` without valid credentials, with `404` for an unknown document and, since 1.6, with `429` beyond a limit (see "Limits"). A request without an upgrade gets `426 upgrade_required`.

Messages are binary and framed as y-websocket frames them, so stock Yjs providers can connect: a varint message type, then the payload.

| Type | Payload | Meaning |
|---|---|---|
| `0` sync | y-protocols sync message: step 1 (state vector), step 2 (missing updates) or update | Both sides send step 1 on connect and answer the other's with step 2; afterwards every change is an update. A sync message of any other subtype is ignored. |
| `1` awareness | y-protocols awareness update | Presence. Clients publish `{ "user": { "name": "…", "color": "#rrggbb" } }` and BlockNote adds the cursor. The server relays it and withdraws a client's presence when its socket closes. The web client sends caret moves at most every 100 ms and renews its state about every 1.2 s, and drops a peer not renewed for 3.5 s (ADR 0291); receivers take only a `#rrggbb` colour and the first 64 characters of a name. Neither changes the wire format. |
| `3` awareness query | none | The server answers with the awareness of everyone present. |

Unknown message types are ignored. A message larger than 16 MiB (or the server's lower limit) closes the connection with `1009`; so does sending more than one message's worth before the document has opened. Bytes that are not a message close it with `4400`. When the note is deleted the server closes the room with `4410`. A connection that answers no ping for the idle timeout is closed with `4408` (since 1.6).

The server tries every change on a copy of the document before applying it. A change that would add a shared type other than the three of the format, a node type or attribute the editor schema does not have, or an unknown mark, is not applied, and the connection that sent it is closed with `4422`. The `meta` map is written by the server only; a client's change to it is reverted.

A `read` session receives everything and may publish awareness; sync step 2 and update messages from it are dropped.

### What the server does with a document

- **Open.** The document is loaded from its stored snapshot when there is one, otherwise built from the markdown file. A snapshot whose `baseRevision` is not the file's current `etag` is reconciled with the file first.
- **Flush.** An edited document is written to its file, as one commit through the same write path as `PUT`, 5 seconds after the last edit or 60 seconds after the first unwritten one, when the last client has left, and when the server stops. Lines that were not edited keep the bytes they have in the file. A result identical to the file makes no commit. After a flush the server sets `meta.baseRevision`.
- **Reconcile.** When the file changes underneath a live document (a commit pulled from the git remote): a document without unwritten edits takes the file's content; edits on different lines are merged three ways, as one server transaction that every client receives; edits on the same lines are forked. Since 1.5 a fork keeps the document: the people typing in it lose nothing under their cursor. The document is rebased on the incoming file and written over it, the incoming version is committed next to it as a conflict copy, and `meta.conflictCopy` names that copy. (Up to 1.4 the file kept its path and the document's version became the copy.)
- **Rename and delete underneath.** A rename pulled from git moves the open document with the note: it keeps its `docId` and its unwritten edits, and the next flush writes to the new path. A deletion closes the room with `4410`; unwritten edits are written back to the deleted path first, which restores the note with them.
- **Persist.** Snapshots are kept by `docId` in the server's blob store. They exist so that a reconnecting client and the server share one Yjs history; the markdown file remains what the document is rebuilt from.

Measured cadence and the reasons are in `docs/web/s4-spike-report.md`.

## Differences from the surface sketched in S1

`docs/web/s1-tauri-inventory.md` listed the server surface before this spike. What differs, and why:

| S1 sketch | This version | Reason |
|---|---|---|
| `PUT` with no precondition is last-write-wins | `428`; `If-Match: *` asks for last-write-wins | An absent header should not silently overwrite. |
| A stale `PUT` is rejected, conflict copy on request | Always a conflict copy, answered with `409` | The save is never lost, also when the client goes away. |
| `POST /v1/files/{path}/rename`, rewrites wikilinks | `POST /v1/rename`, rewrites wikilinks on request since 1.4 | Unambiguous paths; protocol 1.0 to 1.3 clients keep a move that only moves. |
| `GET /v1/entries`, `GET /v1/changes`, attachments routes | Not in 1.1 | Additive; listed as next steps in the spike reports. Attachments already work as plain files through `/v1/files`. |
| Collab tickets | `POST /v1/collab/tickets`, since 1.1 | As sketched. |
