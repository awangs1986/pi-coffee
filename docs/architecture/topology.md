# PI Coffee target topology

## Modules and seams

```text
┌──────────────────────────────┐
│ Browser Shell (one tab)      │
└──────────────┬───────────────┘
               │ browser Frames
┌──────────────▼───────────────┐
│ Web Server / Control Plane   │── Gitea OAuth + allow-list (ADR-0004/0010)
│ - static shell               │── LLM Relay → CPA
│ - Browser Bridge             │── usage metadata
└──────────────┬───────────────┘
               │ Host Frames (private transport) + login name header
┌──────────────▼───────────────┐
│ Agent Host (one shared VM)   │
│ - Session registry per user   │
│ - <workdir>/<user>, <sessions>/<user>
│ - cursor/replay               │
│ - Pi RPC / Codex app-server   │
│   adapter (PI_COFFEE_AGENT)   │
│ - native transcript/context   │
│ - Task files/inbox/worktree   │
└──────────────────────────────┘
```

The current code implements the Browser Bridge, the Gitea login, the per-user Host Session registries, and the Pi RPC adapter. The two Browser Users share one User VM and one model login (ADR-0010); the Host keeps them apart by login name.

## Ownership rule

The Agent Host owns Session state and durable user content. The Control Plane owns routing metadata and bounded usage metadata. A Frame may cross the transport seam; a prompt, tool result, transcript, or image body must not become a durable Control Plane record.

## Normal lifecycle

1. Browser opens a WebSocket and sends a versioned `open` Frame.
2. Web Server opens a private Host connection and forwards the Frame.
3. Host creates or attaches a Session and returns `opened` with an opaque ID, state, and Cursor.
4. Browser sends `prompt`; Host acknowledges acceptance, then streams Pi Events.
5. Host keeps the Pi process and replay buffer alive when the Browser WebSocket closes.
6. A later Browser connection sends the Session ID and last Cursor; Host replays newer Events or declares `resync_required`.

## Failure semantics

| Failure | Expected owner/action |
|---|---|
| Browser refresh/close | Web Bridge detaches; Host Session continues. |
| Web Server restart | User reconnects; Host remains the durable execution owner if its process is alive. |
| Host process restart | 0.1 reopens native Pi session by `--session-id` and native transcript; MVP documents this as a gap. |
| Relay outage | Host receives a structured model error; prompt transcript remains in the User VM. |
| Gitea outage | Existing cookies keep working until they expire; new logins wait for Gitea. |
| User VM failure | Owner restores the VM snapshot manually; Control Plane marks Host unhealthy. |

## Deep module rule

Keep agent-specific knowledge behind `PiSessionFactory`/`PiSession` (Pi RPC today, `codex app-server` since ADR-0011; `PI_COFFEE_AGENT` selects one per Host). Keep transport validation behind the protocol codec. Web code should not know how Pi starts, and Host code should not know how a browser renders text. This is the seam that lets later V5 capabilities be added one at a time.
