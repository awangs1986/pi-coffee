# PI Coffee Agent Runtime

PI Coffee 的 User VM 运行时领域词汇；网页与中央网关属于独立的 Server。

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
A user-level objective pursued through one or more Conversations; it is not itself a repository or a filesystem directory.
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
The optional capability through which a parent Pi Session delegates bounded work to child Sessions.
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
The authenticated transport between Browser Shell and Host, without ownership of Pi session state.
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

**Conversation Inbox**:
The directory inside one Conversation's Workspace where uploaded and pasted originals are retained.
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
The User VM boundary within which Pi has its owner's unrestricted execution authority, including root capability.
_Avoid_: in-process sandbox, permission gate

## Code collaboration

**Repository**:
The Gitea repository that is authoritative for a project's shared, published code history.
_Avoid_: local project directory, final public archive

**Project**:
PI Coffee's registration of a Repository for use by Conversations.
_Avoid_: default-branch checkout, shared worktree

**Conversation**:
A Host-owned Pi Session and its work context. Every Conversation has one dedicated Workspace; a code Conversation's Workspace is a Checkout with a Conversation Branch.
_Avoid_: browser tab, cross-host code backup

**Workspace**:
The stable User VM directory owned by one Conversation. A Chat Workspace is an ordinary directory; a Project Workspace is an independent Checkout. Workspace type and Chat/Work runtime mode are separate dimensions.
_Avoid_: shared chat directory, security sandbox, runtime mode

**Checkout**:
The independent local copy of a Repository in which one Conversation edits and tests code.
_Avoid_: managed worktree, security sandbox

**Conversation Branch**:
The code branch assigned exclusively to one Conversation and shared through Gitea.
_Avoid_: shared writable branch, project default branch

**Checkpoint**:
A committed stage of code work whose remote synchronization status is explicitly known; local-only commits remain unsynchronized.
_Avoid_: VM snapshot, conversation backup, passing test result

**Integration**:
The incorporation of a Conversation's code into a target branch through Gitea's pull request and merge process.
_Avoid_: local project merge, Host merge proposal

**Code Continuation**:
A new Conversation on another host that starts from a verified remote code checkpoint, without inheriting the previous native session or unversioned files.
_Avoid_: automatic session migration, shared branch takeover
