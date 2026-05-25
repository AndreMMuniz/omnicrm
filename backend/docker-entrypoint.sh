#!/bin/sh
set -eu

# Run schema migrations before starting the API server.
# This keeps FastAPI startup free of Alembic logic and works across Docker hosts.
if [ "${RUN_DB_MIGRATIONS:-1}" = "1" ]; then
  echo "Running database migrations..."
  alembic upgrade head
fi

echo "Starting API server..."
exec "$@"
