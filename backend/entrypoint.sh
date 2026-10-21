#!/bin/sh
# Sources each file under a mounted Kubernetes Secret volume into an
# environment variable named after the file, then execs the real command.
#
# Replaces raw `env: valueFrom: secretKeyRef` injection (issue #1293): every
# secretKeyRef env var is visible in `kubectl describe pod` output and in
# /proc/<pid>/environ for any process in the container, whereas a Secret
# mounted as a volume is only readable from the filesystem path it's mounted
# at, permissioned like any other file. Reading the file into an env var here
# — inside the container's own entrypoint, not via the Kubernetes API — keeps
# every existing `process.env.X` read in the application code unchanged.
set -eu

SECRETS_DIR="${SECRETS_DIR:-/etc/secrets}"

if [ -d "$SECRETS_DIR" ]; then
  for secret_file in "$SECRETS_DIR"/*; do
    [ -f "$secret_file" ] || continue
    var_name="$(basename "$secret_file")"
    export "$var_name=$(cat "$secret_file")"
  done
fi

exec "$@"
