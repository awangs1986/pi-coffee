# Conversation history lives in Pi's session store in the User VM

Status: accepted (owner decision, 2026-09-03)

The durable record of every conversation is Pi's own session file (`*.jsonl`) in the User VM's `PI_COFFEE_SESSION_DIR`. The Host lists conversations from that store (`SessionManager.listAll`), resumes any of them by id (`pi --session <file>`), and on every `open` projects the completed entries into a `history` frame for the browser. The Web Server holds no conversation state; the browser keeps nothing across page loads except which conversation it last displayed. Reconnect replay is reduced to the in-flight tail (Events after the last completed message), because everything before that is served from the store.

Consequences: any browser, on any machine, sees the full past conversation the moment it opens it; a Host restart or an idle shutdown of the Pi process loses no messages; the Control Plane still never stores prompt or transcript content (ADR-0003). What this does not yet cover is recovering a run that was mid-stream when the Host itself died — that remains `REC-001`.
