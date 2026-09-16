# Control Plane relays; User VM owns execution and content

Status: accepted

The Control Plane/Web VM owns browser routing, the central LLM Relay, and bounded usage metadata. Each User VM's Agent Host owns Pi execution, native transcripts, context, task files, and uploads. This keeps the upstream credential in one place and lets a browser disconnect without terminating work, while avoiding a second transcript store in the Control Plane.
