# Plugin consolidation acceptance — 2026-09-29

Tracking: [Pi #1](https://github.com/awangs1986/pi-coffee/issues/1) and
[Server #3](https://github.com/awangs1986/pi-coffee-server/issues/3).

The former aggregate main a1c4e4acc88ffd774a09598f1cbd67337ab9522e is preserved
under compatibility/aggregate. Each standalone main listed in
[imports.json](../releases/imports.json) remains a Git ancestor. Runtime source is
unchanged; only package versions, source/release metadata and orchestration change.

| Package | New version | Public acceptance |
| --- | --- | --- |
| Harness | 0.1.3 | 49 tests and 2 native packed-package tests |
| LSP | 0.4.2 | 81 tests and 1 packed-package test |
| Context Handoff | 0.2.0-experimental.2 | 80 tests |

Fresh checkout `6e299f7` passed all package checks plus combined native installation.
The retained aggregate separately passed 142 tests and 3 package tests. Node was
22.23.2; native Pi was 0.87.1. Scripted/offline acceptance does not establish live
model quality or production deployment.

Review identified a release-completeness gap: a native source extension can load
while its built public protocol export is absent. A regression first demonstrated
that incomplete output was accepted. Packaging now rejects missing exports, CLI,
Skill and extension entries before packing and checks the resulting file manifest.
The installed consumer imports Handoff's protocol and Harness's public API, then
installs all three packages through native Pi and queries their independent versions.
Both root integration tests passed after the correction. Review also corrected
historical installation instructions and the Harness package-boundary wording.

Security review found no new auth, data-isolation, credential or dependency issues;
all three dependency audits reported zero vulnerabilities. No production configuration
or model account was changed. Final source, mirrors, release checksums and Server
consumer acceptance are recorded in the linked Issues after publication.
