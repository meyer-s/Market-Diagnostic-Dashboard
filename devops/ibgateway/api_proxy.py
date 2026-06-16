#!/usr/bin/env python3
from __future__ import annotations

import os
import select
import socket
import sys
import threading
from contextlib import suppress


def _parse_allowed_ips(raw: str) -> set[str]:
    return {item.strip() for item in raw.split(",") if item.strip()}


LISTEN_HOST = os.getenv("IBGATEWAY_API_PROXY_HOST", "0.0.0.0")
LISTEN_PORT = int(os.getenv("IBGATEWAY_API_PROXY_PORT", "4003"))
TARGET_HOST = os.getenv("IBGATEWAY_API_PROXY_TARGET_HOST", "127.0.0.1")
TARGET_PORT = int(os.getenv("IBGATEWAY_API_PROXY_TARGET_PORT", "4002"))
ALLOWED_IPS = _parse_allowed_ips(os.getenv("IBGATEWAY_API_PROXY_ALLOWED_IPS", ""))


def _log(message: str) -> None:
    print(message, flush=True)


def _close(sock: socket.socket) -> None:
    with suppress(OSError):
        sock.shutdown(socket.SHUT_RDWR)
    with suppress(OSError):
        sock.close()


def _forward(left: socket.socket, right: socket.socket) -> None:
    sockets = [left, right]
    try:
        while True:
            readable, _, _ = select.select(sockets, [], [])
            for sock in readable:
                data = sock.recv(65536)
                if not data:
                    return
                target = right if sock is left else left
                target.sendall(data)
    except OSError as exc:
        _log(f"proxy session ended: {exc}")
    finally:
        for sock in sockets:
            _close(sock)


def main() -> int:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind((LISTEN_HOST, LISTEN_PORT))
    listener.listen(20)
    _log(
        "IB Gateway API proxy listening on "
        f"{LISTEN_HOST}:{LISTEN_PORT} -> {TARGET_HOST}:{TARGET_PORT}"
    )

    while True:
        client, address = listener.accept()
        client_ip = address[0]
        if ALLOWED_IPS and client_ip not in ALLOWED_IPS:
            _log(f"rejected API proxy client from {client_ip}")
            _close(client)
            continue
        try:
            upstream = socket.create_connection((TARGET_HOST, TARGET_PORT), timeout=5)
        except OSError as exc:
            _log(f"failed to connect to Gateway API target: {exc}")
            _close(client)
            continue
        thread = threading.Thread(target=_forward, args=(client, upstream), daemon=True)
        thread.start()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(0)
    except Exception as exc:
        print(f"fatal API proxy error: {exc}", file=sys.stderr, flush=True)
        raise
