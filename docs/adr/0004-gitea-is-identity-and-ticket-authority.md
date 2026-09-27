# Gitea is PI Coffee's identity and ticket authority

Status: accepted

The internal Gitea instance is the sole human identity source for 0.1 and the authoritative store for PI Coffee Issues, decisions, dependencies, and acceptance evidence. PI Coffee keeps only the minimum routing information needed to reach a fixed User VM; it does not expose Gitea or treat it as the final code archive.

[ADR-0012](./0012-owner-privileges-and-gitea-checkouts.md) extends Gitea authority to synchronized project code, branches and PR integration. GitHub may remain a later publication destination; VM conversations and unversioned files are outside this authority.
