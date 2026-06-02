#!/bin/sh
set -eu

# Run schema migrations before starting the API server.
# This keeps FastAPI startup free of Alembic logic and works across Docker hosts.
if [ "${RUN_DB_MIGRATIONS:-1}" = "1" ]; then
  echo "Alembic working directory: $(pwd)"
  echo "Alembic versions present in image:"
  ls -1 /app/alembic/versions || true
  echo "Alembic heads before upgrade:"
  alembic heads || true
  echo "Running database migrations..."
  alembic upgrade head
fi

echo "Starting API server..."
exec "$@"
