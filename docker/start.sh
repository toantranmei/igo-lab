#!/bin/sh
# Entry point of both images (docker/Dockerfile); ROLE is set by the image target.
#   ROLE=web     apply pending migrations as the owner role (DATABASE_OWNER_URL), then serve the site on $PORT
#   ROLE=worker  run the job worker (calls the Claude CLI); no port
set -e
cd /app
case "${ROLE:-web}" in
  web)
    if [ -n "$DATABASE_OWNER_URL" ]; then
      node migrate.mjs
    else
      echo "start: DATABASE_OWNER_URL not set, migrations skipped"
    fi
    # Docker sets HOSTNAME to the container id; the Next standalone server binds to it, so pin every interface
    export HOSTNAME=0.0.0.0
    exec node apps/web/server.js
    ;;
  worker)
    exec node main.mjs
    ;;
  *)
    echo "start: unknown ROLE '$ROLE' (web | worker)" >&2
    exit 64
    ;;
esac
