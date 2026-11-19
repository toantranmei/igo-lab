#!/bin/sh
# One image, two processes (Coolify: one application each, same image, ROLE decides):
#   ROLE=web     apply pending migrations as the owner role, then serve the site on :3100
#   ROLE=worker  run the job worker (calls the Claude CLI); no port
set -e
case "${ROLE:-web}" in
  web)
    if [ -n "$DATABASE_OWNER_URL" ]; then
      pnpm db:migrate
    else
      echo "start: DATABASE_OWNER_URL not set, migrations skipped"
    fi
    exec pnpm start
    ;;
  worker)
    exec pnpm worker
    ;;
  *)
    echo "start: unknown ROLE '$ROLE' (web | worker)" >&2
    exit 64
    ;;
esac
