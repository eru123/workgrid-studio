#!/usr/bin/env bash
# Run cargo under a hard ~20% resource cap of this host (8 cores / 19 GiB):
#   CPU  — 160% quota (= 1.6 of 8 cores)
#   RAM  — MemoryMax 3900M (~20% of 19 GiB); rustc OOM-killed past that
#   I/O  — idle class, and nice -n 19 so anything interactive wins the CPU
# Usage: scripts/cargo-throttled.sh <cargo args...>   (run from src-tauri/)
set -euo pipefail
exec systemd-run --user --scope --quiet \
  -p CPUQuota=160% \
  -p MemoryMax=3900M \
  nice -n 19 ionice -c 3 \
  cargo "$@"
