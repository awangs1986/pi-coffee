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

**Control Plane**:
The coordination role around the Web Server that authenticates users, selects a fixed User VM, relays model traffic, and records only bounded routing/usage metadata.
_Avoid_: execution host, transcript server

**User VM**:
An owner-managed isolated virtual machine in which one internal user's Host, Pi sessions, context, and files live.
_Avoid_: sandbox, VM worker

**Browser Shell**:
The single browser tab that presents one user's collection of Tasks and Sessions.
_Avoid_: browser session, web worker

**Task**:
A user-level unit of work that may contain one or more Pi Sessions and a worktree/inbox in the User VM.
_Avoid_: HTTP request, prompt

**Native Transcript**:
The session history written and read by the original Pi Agent in the User VM.
_Avoid_: Control Plane log, browser cache

**Model Context**:
The messages and agent state that Pi uses to continue a Session.
_Avoid_: Browser projection, usage record

**Session**:
One Pi conversation owned by a Host. A Session remains alive independently of any Browser User connection until it is explicitly stopped or the Host shuts down.
_Avoid_: tab, request

**Subagent**:
A focused child Pi Session launched by the optional `pi-subagents` extension for a bounded delegated task. Its transcript and artifacts remain in the owning User VM.
_Avoid_: worker, remote agent

**Subagent Extension**:
The locked upstream `pi-subagents` Module plus PI Coffee's small resource Adapter. It is loaded by the Host but its `subagent` and `bg_wait` tools are opt-in through Harness `search_tools`.
_Avoid_: V5 orchestration, Control Plane worker

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

**LLM Relay**:
The transparent Control Plane route from a Host model request to the configured CPA endpoint, including JSON and SSE streams.
_Avoid_: model server, second agent

**CPA Endpoint**:
The existing OpenAI-compatible upstream relay used for Chat Completions, Responses, model listing, and response compaction.
_Avoid_: provider implementation

**Routing Index**:
The minimal Control Plane record that maps an authenticated user to a fixed User VM and opaque transport identifiers.
_Avoid_: user database, transcript index

**Usage Metadata**:
Bounded accounting information such as token counts, timing, and status that does not contain prompt or tool-output正文.
_Avoid_: conversation log

**Task Inbox**:
The User VM location where files uploaded for a Task are retained.
_Avoid_: Control Plane upload store, temporary web directory

**Image Message**:
An original image retained in the User VM and presented to Pi either as model-supported image content or as a User VM reference.
_Avoid_: thumbnail, screenshot cache

**Deployment Skill**:
The idempotent installation and enrollment procedure for the Agent Host on a User VM.
_Avoid_: VM manager, installer daemon

**Enrollment Token**:
A one-time value used to register an Agent Host before it receives a revocable Host identity.
_Avoid_: LLM key, user password

**Host Identity**:
The revocable transport identity by which the Control Plane addresses one Agent Host.
_Avoid_: VM owner, API key

## Release vocabulary

**MVP**:
The first PI Coffee release: original Pi Agent, Host, Web Server, text prompts, streamed text, and reconnect continuity.
_Avoid_: V5 slice, production release

**Frozen V5 baseline**:
The existing latest Gitea version of Picode, kept unchanged while PI Coffee proves its MVP.
_Avoid_: legacy V5, source branch

**Execution Seam**:
The User VM isolation point at which Pi may use the owner's normal shell and file rights.
_Avoid_: in-process sandbox, permission gate

**Worktree**:
A repository directory assigned to a Task for organizing changes; it is not a security control.
_Avoid_: sandbox, permission scope
