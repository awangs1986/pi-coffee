# PI Coffee

PI Coffee is the small, independent web product line for talking to the original Pi coding agent. It is the experimental MVP track; the existing Picode V5 repository remains a frozen reference and is not a source of work for this track.

## Participants

**Browser User**:
The internal person who writes prompts and reads Pi replies in a browser.
_Avoid_: operator, tenant

**Pi Agent**:
The unmodified upstream coding agent that reasons, calls tools, and writes its native session transcript.
_Avoid_: V5 agent, Coffee agent

**Host**:
The long-lived process in the User VM that owns Pi Agent sessions and continues them when a browser disconnects.
_Avoid_: worker, sandbox, VM manager

**Web Server**:
The browser-facing process that serves the PI Coffee page and relays conversation frames to a Host.
_Avoid_: Pi UI process, Pi runtime

**Session**:
One Pi conversation owned by a Host. A Session remains alive independently of any Browser User connection until it is explicitly stopped or the Host shuts down.
_Avoid_: tab, request

## Conversation stream

**Frame**:
One versioned JSON message exchanged between the Browser User, Web Server, and Host.
_Avoid_: packet, event (when referring to commands)

**Event**:
A Pi-originated observation, such as a text delta or settled marker, carried in a server Frame.
_Avoid_: response (a response may also be an acknowledgement or error)

**Cursor**:
The monotonically increasing position assigned to an Event within a Session.
_Avoid_: message id, offset (for the session position)

**Replay**:
Sending buffered Events after a Browser User reconnects with a prior Cursor.
_Avoid_: retry, duplicate delivery

**Bridge**:
The Web Server module that validates browser Frames and forwards them to a Host connection without owning Pi state.
_Avoid_: proxy (when discussing session ownership)

## Release vocabulary

**MVP**:
The first PI Coffee release: original Pi Agent, Host, Web Server, text prompts, streamed text, and reconnect continuity.
_Avoid_: V5 slice, production release

**Frozen V5 baseline**:
The existing latest Gitea version of Picode, kept unchanged while PI Coffee proves its MVP.
_Avoid_: legacy V5, source branch
