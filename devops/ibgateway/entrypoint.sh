#!/usr/bin/env bash
set -euo pipefail

display="${DISPLAY:-:1}"
resolution="${XVFB_RESOLUTION:-1280x900x24}"

mkdir -p "${HOME}/Jts"

Xvfb "${display}" -screen 0 "${resolution}" -ac +extension GLX +render -noreset &
xvfb_pid="$!"

fluxbox >/tmp/fluxbox.log 2>&1 &
x11vnc_args=(-display "${display}" -forever -shared -listen 0.0.0.0 -rfbport 5900)
if [[ -n "${VNC_PASSWORD:-}" ]]; then
  x11vnc -storepasswd "${VNC_PASSWORD}" /tmp/vnc.pass >/dev/null 2>&1
  x11vnc_args+=(-rfbauth /tmp/vnc.pass)
else
  x11vnc_args+=(-nopw)
fi
x11vnc "${x11vnc_args[@]}" >/tmp/x11vnc.log 2>&1 &

web_root="/usr/share/novnc"
if [[ -d "${web_root}" ]]; then
  websockify --web="${web_root}" 6080 localhost:5900 >/tmp/novnc.log 2>&1 &
fi

gateway_bin="$(find /opt/ibgateway -type f -name ibgateway -perm /111 | sort -V | tail -n 1)"
if [[ -z "${gateway_bin}" ]]; then
  echo "Could not find installed IB Gateway executable under /opt/ibgateway" >&2
  exit 1
fi

cleanup() {
  kill "${xvfb_pid}" 2>/dev/null || true
}
trap cleanup EXIT

exec "${gateway_bin}"
