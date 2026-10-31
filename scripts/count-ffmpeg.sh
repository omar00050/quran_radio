#!/bin/bash
# Count running ffmpeg processes to verify audio-server refactor impact.
# On the audio-server host, expect ~35 ffmpeg processes (one per unique station).
# In bot processes with AUDIO_MODE=remote, expect 0 ffmpeg processes.

count=$(pgrep -c ffmpeg 2>/dev/null || echo 0)
echo "Total ffmpeg processes: $count"

if [ "$count" -gt 0 ]; then
  pids=$(pgrep ffmpeg)
  echo ""
  echo "PIDs: $pids"
fi
