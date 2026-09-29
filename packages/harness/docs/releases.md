# Independent harness releases

Current version: **0.1.3**. Immutable tag: **harness/v0.1.3** in
[awangs1986/pi-coffee](https://github.com/awangs1986/pi-coffee).

`package.json` owns this plugin's version; its lockfile must agree. Versions are
independent of other plugins, native Pi and Server. Follow the shared
[release, installation and rollback procedure](../../../../docs/releases/README.md).
PATCH records compatible fixes or packaging changes, MINOR compatible capabilities,
and MAJOR incompatible contracts after stabilization. Pre-1.0 releases must state
migration requirements. Never move a published tag or overwrite release assets.

Query the installed version using `/harness version` in native Pi.
Retain the previous artifact and task data, settle active work, replace the previous
registration and verify exactly one plugin copy loads. A source release does not
update a running Host or establish production acceptance. Old standalone repositories
and their tags remain historical records; new maintenance happens in this package.
