# PI Coffee Agent Runtime deployment files

`deploy/uservm/` installs the Agent Host and original Pi inside one owning User
VM. Web gateway, identity and Relay units are maintained in
[`awangs/pi-coffee-server`](http://gitea:3000/awangs/pi-coffee-server).

The Host runs as the VM owner because Pi needs that user's shell, files, Git
credentials and native session store. The VM is the execution isolation seam.
The Host token is shared only with the fixed route in PI Coffee Server.

Nothing here creates, snapshots or restores VMs. Those remain owner operations.
