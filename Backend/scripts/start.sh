#!/bin/sh
# Cloud Run startup script with DB connection retry.
# Cloud SQL can take 10-30s to become ready; Error 409 "invalidState" is often transient.

set -e

MAX_RETRIES=6
RETRY_DELAY=10

echo "[start] Running migrations (will retry up to $MAX_RETRIES times if DB unavailable)..."

i=0
until python manage.py migrate --noinput; do
  i=$((i + 1))
  if [ "$i" -ge "$MAX_RETRIES" ]; then
    echo "[start] ERROR: Migrations failed after $MAX_RETRIES attempts."
    echo "[start] Ensure Cloud SQL instance is RUNNING and Cloud Run has Cloud SQL connection configured."
    exit 1
  fi
  echo "[start] DB not ready (attempt $i/$MAX_RETRIES), retrying in ${RETRY_DELAY}s..."
  sleep "$RETRY_DELAY"
done

echo "[start] Migrations OK. Starting Gunicorn..."
exec gunicorn base.wsgi:application --bind 0.0.0.0:8000 --workers 2 --timeout 120
