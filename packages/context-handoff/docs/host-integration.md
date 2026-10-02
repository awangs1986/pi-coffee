# Host-owned Handoff

SPEC revision 7. Canonical source: `pi-coffee/packages/context-handoff`.
Independent package: `context-handoff`; current version `0.2.0-experimental.4`.
Host/Web/native adapters live in pi-coffee-server and consume an immutable artifact.

## Responsibilities

| Host / caller | Plugin |
| --- | --- |
| Enable/disable by including/omitting the extension | Expose Handoff and original-evidence tools when loaded |
| Choose timing, any compression schedule and user confirmation policy | Act only on the exact explicit request |
| Settle work, serialize operations, own Stop/reconnect/deadlines | Check settlement, input/project/history changes and cancellation |
| Verify the committed result and decide next action | Prepare Task State, validate attribution, commit in the same native session |
| Decide retry, native recovery or later authorized continuation | Report failure; never schedule retries, fallback or model continuation |

Threshold, overflow and ordinary `/compact` remain native Pi. Neither installation
nor a successful Handoff starts a compression-count cycle. `/handoff` remains a
native Pi convenience command with experimental confirmation; `/handoff version`
reports the installed manifest. Hosts use RPC and own their UI policy.

## Existing public API

```ts
import { HANDOFF_REQUEST, HANDOFF_VERSION, resolveHandoffExtension } from "context-handoff/protocol";

// Include resolveHandoffExtension() once only if Host enables this capability.
// Wait for active/delegated work to settle and take ownership of the operation.
const before = await pi.getState();
const result = await pi.compact(HANDOFF_REQUEST);
const after = await pi.getState();
// Verify new native compaction entry, not just a successful RPC response:
// details.plugin === "pi-handoff", details.pluginVersion === HANDOFF_VERSION,
// details.trigger === "manual", and before/after sessionId + sessionFile agree.
```

`HANDOFF_REQUEST` stays `context-handoff:manual:v1`. `manual` is Pi's explicit
compaction reason. A Host can decide when to send it without asking the plugin to
count compressions. Changing the scheduling policy requires no plugin change.
Pi's explicit compact path can abort an active turn: Host should invoke it only
at a settled boundary and own any subsequent authorized prompt.

The plugin returns native compaction metadata: `plugin`, `pluginVersion`,
`trigger`, schema `version`, attributed `state`, `generation`, and `evidenceRecord`.
New entries omit `nativeLimit`. Old entries/journals remain readable; uncertain
historical continuation is reported without replaying actions.

## Failure and lifecycle

An invalid state, timeout, arriving input, unsettled tool or changed project cancels
the preparation. No Handoff or replacement native compaction is committed; the RPC
rejects and the plugin reports the reason. The caller can explicitly retry or
request native compaction after inspecting the outcome. If persistence or commit
confirmation fails, settlement may be uncertain: retain the session and recover
before executing more work. Success is not proof of semantic fidelity.

Host keeps operation ownership across browser disconnects and an RPC response
timeout. Do not blindly retry an operation whose commit is unknown. Check native
state/history and the pinned plugin version; Stop must remain available. The plugin
never sends a hidden continuation. Existing evidence-order safeguards still apply
to protected writes when the caller submits the next prompt.

## Upgrade and evaluation

Remove both `--handoff-trigger` and `--handoff-native-limit`. Retain budget flags
`--handoff-output-tokens` and `--handoff-timeout-ms` as needed. Generation inherits
Pi's model/thinking setting. Install exactly one immutable package artifact, verify
its version, then run the consuming Host's own integration checks. A source edit or
package check does not update a Host pin or deploy it.

Legacy live/paired/drift/ABCD runners are preserved but fail immediately because
their schedule depended on plugin-owned cadence. Their scoring tools still work.
A future live runner must send explicit requests at declared boundaries, verify
actual native/Handoff commits, and record how continuation was requested. Historical
results cannot be relabelled as evidence for this invocation contract.
