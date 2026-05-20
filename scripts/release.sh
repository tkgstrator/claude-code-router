#!/bin/bash
set -e

# Release script — Docker only now that the @CCR/cli npm package and the
# packages/core npm publish flow have been retired. Publishes the
# consolidated Vite + Hono image to Docker Hub.

VERSION=$(node -p "require('../package.json').version")
IMAGE_NAME="ccr/router"
IMAGE_TAG="${VERSION}"
LATEST_TAG="latest"

PUBLISH_TYPE="${1:-docker}"

if [ "$PUBLISH_TYPE" != "docker" ] && [ "$PUBLISH_TYPE" != "all" ]; then
  echo "Usage: $0 [docker|all]"
  exit 1
fi

echo "Releasing Claude Code Router v${VERSION}"

if ! docker info &>/dev/null; then
  echo "Error: Docker is not running"
  exit 1
fi

docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" -f ../Dockerfile ..
docker tag "${IMAGE_NAME}:${IMAGE_TAG}" "${IMAGE_NAME}:${LATEST_TAG}"
docker push "${IMAGE_NAME}:${IMAGE_TAG}"
docker push "${IMAGE_NAME}:${LATEST_TAG}"

echo "Released ${IMAGE_NAME}:${IMAGE_TAG} (+ :latest)"
