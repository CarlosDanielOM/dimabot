#!/bin/sh
set -eu

DATA_DIR="${PIPER_DATA_DIR:-/voices}"
DEFAULT_VOICE="${PIPER_DEFAULT_VOICE:-en_US-ryan-medium}"
EXTRA_VOICES="${PIPER_EXTRA_VOICES:-es_MX-ald-medium}"
HOST="${PIPER_HTTP_HOST:-0.0.0.0}"
PORT="${PIPER_HTTP_PORT:-5000}"

mkdir -p "$DATA_DIR"

ensure_voice() {
  VOICE_NAME="$1"

  if [ -f "$DATA_DIR/${VOICE_NAME}.onnx" ] && [ -f "$DATA_DIR/${VOICE_NAME}.onnx.json" ]; then
    return 0
  fi

  python3 -m piper.download_voices --data-dir "$DATA_DIR" "$VOICE_NAME"
}

ensure_voice "$DEFAULT_VOICE"

for voice in $EXTRA_VOICES; do
  ensure_voice "$voice"
done

exec python3 -m piper.http_server \
  -m "$DEFAULT_VOICE" \
  --data-dir "$DATA_DIR" \
  --host "$HOST" \
  --port "$PORT"
