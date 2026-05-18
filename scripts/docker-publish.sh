#!/bin/bash
set -e

docker buildx build --platform=linux/amd64,linux/arm64 -t tkgling/claude-code-router:latest . --push
