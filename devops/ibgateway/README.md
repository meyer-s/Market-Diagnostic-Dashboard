# IB Gateway Docker Runtime

This image installs IB Gateway from Interactive Brokers' standalone Linux installer
and runs it under Xvfb with optional noVNC access for manual login.

Build and start with the production compose project:

```bash
docker compose -f docker-compose.yml -f docker-compose.ibgateway.yml up -d --build ibgateway
```

Before using the override for backend or scheduler containers, create the
untracked `devops/env/ibkr-cli-config.toml` from
`devops/ibgateway/ibkr-cli-config.toml.example`. The override mounts that file
into the Python containers so `ibkr-cli` can reach the Gateway service by Docker
DNS name instead of `127.0.0.1`. The paper profile should use port `4003`,
which is the in-container API proxy. That proxy connects to Gateway's local
paper API port from `127.0.0.1`, allowing the Gateway UI setting "Allow
connections from localhost only" to remain enabled.

The compose override binds all exposed ports to `127.0.0.1` on the host:

- `4001`: Gateway live API default
- `4002`: Gateway paper API default
- `4003`: internal API proxy for backend/scheduler clients
- `5900`: VNC
- `6080`: noVNC web UI

The `4003` proxy is not published to the host. It is reachable only on the
Compose network and defaults to accepting `172.18.0.4` and `172.18.0.5`, the
pinned scheduler and backend container addresses.

To log in manually without exposing noVNC publicly:

```bash
ssh -L 6080:127.0.0.1:6080 marketdash
```

Then open `http://127.0.0.1:6080/vnc.html` locally.

Do not commit IBKR account credentials. Keep Gateway settings in the Docker volume
and keep backend `ibkr-cli` config in an untracked env/config mount.
