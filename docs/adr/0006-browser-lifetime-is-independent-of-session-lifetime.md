# Browser lifetime is independent of Pi Session lifetime

Status: accepted

A Browser Shell connection is a projection of a Host Session, not the owner of that Session. Closing or refreshing the browser detaches the projection while the Host continues Pi work and buffers Events for a cursor-based reconnect. This is why Web Server and Host are separate seams from the first MVP.

Native-engine scope update (2026-09-23): [ADR-0013](./0013-native-agent-engines.md) extends the Host to Codex and Claude Code while preserving Pi behavior. Its explicit authentication, native-permission, history and repository boundaries govern that planned extension; this earlier Pi-specific decision does not imply native-engine support is already implemented.
