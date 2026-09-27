#!/usr/bin/env python3
"""Linux admission shim for the upstream PI_SUBAGENT_PI_BINARY seam.

No agent logic, permissions, credentials or transcript processing here. Two
kernel flock permits survive exec into the real Pi and release on actual exit
(including SIGKILL), not on a parent timeout or a stale heartbeat.
"""
import fcntl
import hashlib
import json
import os
import random
import sys
import time


def fail(message):
    print("[subagent admission] " + message, file=sys.stderr, flush=True)
    sys.exit(75)


def acquire(directory, count):
    for slot in random.sample(range(count), count):
        fd = os.open(os.path.join(directory, str(slot)), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            # Keep descriptors away from Node/libuv's standard low descriptors.
            held = fcntl.fcntl(fd, fcntl.F_DUPFD, 200)
            os.set_inheritable(held, True)
            return held
        except BlockingIOError:
            pass
        finally:
            os.close(fd)
    return None


def main():
    if int(os.environ.get("PI_SUBAGENT_DEPTH", "1")) > 1:
        fail("nested subagent launches are disabled; return work to the root conversation")
    root = os.environ.get("PI_COFFEE_SCHEDULER_DIR")
    session = os.environ.get("PI_COFFEE_ROOT_SESSION")
    node = os.environ.get("PI_COFFEE_NODE")
    cli = os.environ.get("PI_COFFEE_PI_CLI")
    if not all((root, session, node, cli)):
        fail("missing VM/root-session/runtime configuration; refusing an unmetered launch")
    key = hashlib.sha256(session.encode()).hexdigest()
    vm_dir = os.path.join(root, "vm")
    session_dir = os.path.join(root, "sessions", key)
    for directory in (vm_dir, session_dir):
        os.makedirs(directory, mode=0o700, exist_ok=True)
    # Process identity covers queued as well as executing children for workspace lifecycle checks.
    # Stale records are harmless: readers verify /proc start time, not PID alone.
    processes = os.path.join(session_dir, "processes")
    os.makedirs(processes, mode=0o700, exist_ok=True)
    with open("/proc/self/stat") as info:
        start = info.read().rsplit(")", 1)[1].split()[19]
    record = os.path.join(processes, str(os.getpid()) + ".json")
    fd = os.open(record, os.O_CREAT | os.O_WRONLY | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as out:
        json.dump({"pid": os.getpid(), "start": start}, out)
    # Never unlink lock files: doing so could let contenders lock different inodes.
    deadline = time.monotonic() + 600
    announced = False
    while True:
        local = acquire(session_dir, 3)
        if local is not None:
            global_slot = acquire(vm_dir, 5)
            if global_slot is not None:
                # Same PID and inherited locks: no supervisor lifetime race, no stale leases.
                os.execv(node, [node, cli, *sys.argv[1:]])
            os.close(local)
        if not announced:
            print("[subagent admission] queued (conversation <=3, VM <=5)", file=sys.stderr, flush=True)
            announced = True
        if time.monotonic() >= deadline:
            fail("queue wait exceeded 10 minutes; task was not started")
        time.sleep(0.05 + random.random() * 0.05)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        fail(type(exc).__name__ + ": admission/exec failed")
