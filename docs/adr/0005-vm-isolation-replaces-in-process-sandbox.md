# VM isolation replaces an in-process command sandbox

Status: accepted

PI Coffee runs the Agent Host inside an owner-managed, isolated User VM. The MVP and 0.1 therefore do not reproduce an in-process Guard, permission approval, or command sandbox stack. Worktrees may organize later Tasks, but they are not a security mechanism; VM snapshots and owner recovery are the execution safety model.
