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
DNS name instead of `127.0.0.1`.

The compose override binds all exposed ports to `127.0.0.1` on the host:

- `4001`: Gateway live API default
- `4002`: Gateway paper API default
- `5900`: VNC
- `6080`: noVNC web UI

To log in manually without exposing noVNC publicly:

```bash
ssh -L 6080:127.0.0.1:6080 marketdash
```

Then open `http://127.0.0.1:6080/vnc.html` locally.

Do not commit IBKR account credentials. Keep Gateway settings in the Docker volume
and keep backend `ibkr-cli` config in an untracked env/config mount.
