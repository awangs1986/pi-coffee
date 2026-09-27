# PI Coffee Agent Runtime deployment files

`deploy/uservm/` installs the Agent Host and original Pi inside one owning User
VM. Web gateway, identity and Relay units are maintained in
[`awangs/pi-coffee-server`](http://gitea:3000/awangs/pi-coffee-server).

The Host runs as the VM owner because Pi needs that user's shell, files, Git
credentials and native session store. The VM is the execution isolation seam.
The Host token is shared only with the fixed route in PI Coffee Server.

Run `sudo deploy/uservm/install-owner-access.sh <vm-owner>` after installing
the systemd unit. It installs one validated sudoers entry and proves that the
service owner can run `sudo -n` as root while retaining the owner's HOME. The
Host itself continues to run as that owner. `npm run probe:owner-access` repeats
the non-interactive probe from the installed runtime.

Nothing here creates, snapshots or restores VMs. Those remain owner operations.
