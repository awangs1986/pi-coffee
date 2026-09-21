#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root: $0 <vm-owner>" >&2
  exit 2
fi
if [ "$#" -ne 1 ] || ! id "$1" >/dev/null 2>&1; then
  echo "usage: $0 <existing-vm-owner>" >&2
  exit 2
fi

owner=$1
owner_home=$(getent passwd "$owner" | cut -d: -f6)
case "$owner_home" in
  /*) ;;
  *) echo "cannot resolve an absolute HOME for $owner" >&2; exit 2 ;;
esac

temporary=$(mktemp /etc/sudoers.d/.pi-coffee-owner.XXXXXX)
trap 'rm -f "$temporary"' EXIT HUP INT TERM
printf '%s ALL=(ALL:ALL) NOPASSWD: ALL\n' "$owner" >"$temporary"
chmod 0440 "$temporary"
visudo -cf "$temporary" >/dev/null
install -o root -g root -m 0440 "$temporary" "/etc/sudoers.d/pi-coffee-$owner"

service_file=/etc/systemd/system/pi-coffee-host.service
if [ -f "$service_file" ]; then
  grep -Fx "User=$owner" "$service_file" >/dev/null || { echo "$service_file does not run as $owner" >&2; exit 1; }
  grep -Fx "Environment=HOME=$owner_home" "$service_file" >/dev/null || { echo "$service_file does not preserve HOME=$owner_home" >&2; exit 1; }
  if grep -Eq '^NoNewPrivileges=(yes|true)$' "$service_file"; then echo "$service_file blocks sudo with NoNewPrivileges" >&2; exit 1; fi
fi

actual=$(su -s /bin/sh -c 'sudo -n id -u' "$owner")
[ "$actual" = 0 ] || { echo "passwordless root probe failed for $owner" >&2; exit 1; }
echo "PI Coffee owner access verified: user=$owner home=$owner_home sudo_uid=$actual"
