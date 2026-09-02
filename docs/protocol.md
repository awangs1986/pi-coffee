# PI Coffee MVP protocol

The Browser and Host use the same versioned JSON frame vocabulary. The Web Server validates the Browser frame and forwards it; it does not reinterpret Pi events and keeps no conversation state.

## Connection sequence

```text
Browser -> Web Server -> Host: {"v":1,"type":"list_sessions"}            (allowed before open)
Host -> Web Server -> Browser: sessions
Browser -> Web Server -> Host: {"v":1,"type":"open", "sessionId?", "after?"}
Host -> Web Server -> Browser: opened
Host -> Web Server -> Browser: history                                   (always, right after opened)
Host -> Web Server -> Browser: event…                                    (only the in-flight tail, if any)
Browser -> Web Server -> Host: prompt | abort | ping | list_sessions
Host -> Web Server -> Browser: ack | event | error | sessions
```

`open` without a `sessionId` creates a Session. `open` with an ID attaches to the live Host Session if there is one, otherwise the Host resumes the conversation from Pi's session store in the User VM (`pi --session <file>`). Either way the Browser receives the same two things: `opened`, then `history`.

## Where conversation state lives

- **Completed messages** live in Pi's own session file in the User VM (ADR-0008). The Host projects them into `history` on every `open`. The Browser renders `history` from scratch and keeps nothing across page loads except which conversation it last looked at.
- **In-flight events** (a message that is still streaming, a tool that is still running) live in the Host's bounded per-Session buffer. After `history`, the Host replays only buffered Events newer than `max(after, cursor of the last completed message)`. So a Browser that has never seen the Session and a Browser that reconnects mid-stream both end up with: history + the current tail, no duplicates.
- If the in-flight tail itself has fallen out of the bounded buffer (a single message with more Events than the buffer), the Host emits `resync_required` instead of a partial tail; completed messages are unaffected because they come from `history`.
- The Host may stop an idle Pi process (no Browser attached, nothing running) after `PI_COFFEE_IDLE_TIMEOUT_MS`. The conversation is unaffected: the next `open` resumes it from the store.

## Client frames

```json
{"v":1,"type":"list_sessions"}
{"v":1,"type":"open","sessionId":"optional","after":42}
{"v":1,"type":"prompt","requestId":"r-1","text":"hello"}
{"v":1,"type":"abort","requestId":"r-1"}
{"v":1,"type":"ping","nonce":"n-1"}
{"v":1,"type":"close"}
```

The MVP accepts image-shaped input in the wire type for forward compatibility, but the browser does not expose upload controls yet.

## Server frames

```json
{"v":1,"type":"sessions","sessions":[{"id":"…","name":"optional","createdAt":"…","updatedAt":"…","messageCount":6,"preview":"first user message","running":false}]}
{"v":1,"type":"opened","sessionId":"…","cursor":0,"state":{"isStreaming":false,"messageCount":0}}
{"v":1,"type":"history","sessionId":"…","leafId":"…","truncated":false,"entries":[
  {"kind":"user","id":"…","at":"…","text":"list files","imageCount":1},
  {"kind":"assistant","id":"…","at":"…","text":"Sure."},
  {"kind":"tool","id":"call-1","at":"…","name":"bash","args":{"command":"ls"},"result":"a.txt","isError":false},
  {"kind":"note","id":"…","text":"会话上下文已压缩…"}
]}
{"v":1,"type":"ack","operation":"prompt","requestId":"r-1"}
{"v":1,"type":"event","sessionId":"…","cursor":1,"event":{"type":"message_update"}}
{"v":1,"type":"error","code":"busy","message":"…","requestId":"r-2"}
```

`history.entries` follows the active branch of Pi's entry tree (leaf → root); abandoned branches are omitted, compactions and branch switches appear as notes so the user sees the whole past conversation rather than the model's current context. The frame is bounded by `MAX_FRAME_BYTES`: when a conversation does not fit, the newest entries are kept and `truncated` is `true` — the rest stays in the User VM's session file. Tool results are capped at 4000 characters. Session-file paths never appear in any frame.

Pi event payloads are opaque JSON values at this seam. The browser renders `message_update` → `text_delta`, tool execution start/end, `message_end` errors, `extension_ui_request` notifications and visible custom messages.

## Lifetime rule

Closing a Browser WebSocket detaches that Browser from the Session. It is not a stop command and must not interrupt Pi. The Host stops a Pi process only during Host shutdown or after the idle timeout above, and in both cases the conversation remains in Pi's session store.
