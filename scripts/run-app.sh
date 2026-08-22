#!/usr/bin/env bash
set -euo pipefail

APP_IMAGE="capacity-api:runtime"
APP_CONTAINER="capacity-api-runtime"
APP_PORT="3000"
LOCALSTACK_ENDPOINT="${LOCALSTACK_ENDPOINT:-http://host.docker.internal:4566}"
AIVEN_CA_PATH="${AIVEN_CA_PATH:-$HOME/Downloads/ca.pem}"

if [ ! -f "$AIVEN_CA_PATH" ]; then
  echo "Aiven CA certificate not found: $AIVEN_CA_PATH"
  exit 1
fi

SECRET_ARN="$(tflocal -chdir=terraform output -raw secret_arn)"

if [ -z "$SECRET_ARN" ]; then
  echo "Terraform secret_arn output is empty"
  exit 1
fi

echo "Building application image..."
docker build -t "$APP_IMAGE" ./api

echo "Removing previous runtime container if present..."
docker rm -f "$APP_CONTAINER" >/dev/null 2>&1 || true

echo "Starting application runtime..."
docker run -d \
  --name "$APP_CONTAINER" \
  --restart unless-stopped \
  --memory=160m \
  -p "${APP_PORT}:3000" \
  -e PORT=3000 \
  -e DB_SECRET_ARN="$SECRET_ARN" \
  -e AWS_ENDPOINT_URL="$LOCALSTACK_ENDPOINT" \
  -e AWS_REGION="${AWS_REGION:-eu-west-3}" \
  -e AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}" \
  -e AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}" \
  -e MYSQL_SSL_CA=/run/secrets/aiven-ca.pem \
  -v "$AIVEN_CA_PATH:/run/secrets/aiven-ca.pem:ro" \
  "$APP_IMAGE"

echo
echo "Runtime started."
echo "Health:    http://localhost:${APP_PORT}/healthz"
echo "Readiness: http://localhost:${APP_PORT}/readyz"
