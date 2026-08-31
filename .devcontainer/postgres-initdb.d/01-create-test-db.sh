#!/usr/bin/env bash
# Provisions a sibling DB used by `bun test` (TEST_DATABASE_URL). Lives
# alongside the dev `rialto` DB on the same postgres container so test runs
# truncate the test DB instead of the dev DB.
#
# Runs once on a fresh postgres data volume — see
# https://github.com/docker-library/docs/blob/master/postgres/README.md#initialization-scripts
set -euo pipefail

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE rialto_test;
EOSQL
