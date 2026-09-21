# VM isolation replaces an in-process command sandbox

Status: accepted; deployment authority refined by [ADR-0012](./0012-owner-privileges-and-gitea-checkouts.md)

PI Coffee runs the Agent Host inside an owner-managed, isolated User VM. The MVP and 0.1 therefore do not reproduce an in-process Guard, permission approval, or command sandbox stack. Host/Pi runs as the VM owner with unrestricted passwordless sudo. VM snapshots and owner recovery are the execution safety model. Conversation checkouts and Gitea organize code; they do not constrain local execution. The sudo deployment and checkout migration still require T0–T4 acceptance.
