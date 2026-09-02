# PI Coffee MVP protocol

The Browser and Host use the same versioned JSON frame vocabulary. The Web Server validates the Browser frame and forwards it; it does not reinterpret Pi events.

## Connection sequence

```text
Browser -> Web Server -> Host: {"v":1,"type":"open", "sessionId?", "after?"}
Host -> Web Server -> Browser: opened
Browser -> Web Server -> Host: prompt | abort | ping
Host -> Web Server -> Browser: ack | event | error
```

`open` without a `sessionId` creates a Session. A later `open` with the same ID attaches to the existing Host Session. `after` is the last Cursor the Browser has rendered; the Host replays newer buffered Events. If the requested Cursor has fallen out of the bounded buffer, the Host emits `resync_required`; the native Pi transcript remains the source for a later resync implementation.

## Client frames

```json
{"v":1,"type":"open","sessionId":"optional","after":42}
{"v":1,"type":"prompt","requestId":"r-1","text":"hello"}
{"v":1,"type":"abort","requestId":"r-1"}
{"v":1,"type":"ping","nonce":"n-1"}
{"v":1,"type":"close"}
```

The MVP accepts image-shaped input in the wire type for forward compatibility, but the browser does not expose upload controls yet.

## Server frames

```json
{"v":1,"type":"opened","sessionId":"…","cursor":0,"state":{"isStreaming":false,"messageCount":0}}
{"v":1,"type":"ack","operation":"prompt","requestId":"r-1"}
{"v":1,"type":"event","sessionId":"…","cursor":1,"event":{"type":"message_update"}}
{"v":1,"type":"error","code":"busy","message":"…","requestId":"r-2"}
```

Pi event payloads are opaque JSON values at this seam. The browser currently renders `message_update` → `text_delta`, while retaining all other Events in the Host replay buffer.

## Lifetime rule

Closing a Browser WebSocket detaches that Browser from the Session. It is not a stop command and must not call `PiSession.stop()`. The Host stops a Pi process only during explicit Host shutdown (an explicit session-stop command is a later iteration).
