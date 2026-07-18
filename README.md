# keycloak-mcp-server

Administer [Keycloak](https://www.keycloak.org/) through the **Model Context Protocol (MCP)** —
manage realms, clients, users, roles, groups, identity providers and sessions from any MCP client
(Claude Code, Claude Desktop, Cursor, …).

> Status: early. The first tool slice (realms/clients/users read) is working; the full admin
> surface is on the roadmap below.

## Install

```bash
npm install
npm run build
```

## Configure

The server talks to the Keycloak Admin REST API. Provide credentials via environment variables
(see [`.env.example`](.env.example)):

| Variable | Default | Notes |
|---|---|---|
| `KEYCLOAK_URL` | `http://localhost:8081` | Base URL |
| `KEYCLOAK_REALM` | `master` | Auth realm (master can administer all realms) |
| `KEYCLOAK_CLIENT_ID` | `admin-cli` | Client used for the grant |
| `KEYCLOAK_ADMIN_USER` / `KEYCLOAK_ADMIN_PASSWORD` | `admin` / `admin` | Password grant |
| `KEYCLOAK_CLIENT_SECRET` | — | If set, uses a client-credentials (service account) grant instead |

## Use with Claude Code

```bash
claude mcp add keycloak node /absolute/path/to/keycloak-mcp-server/dist/index.js \
  --env KEYCLOAK_URL=http://localhost:8081 \
  --env KEYCLOAK_ADMIN_USER=admin \
  --env KEYCLOAK_ADMIN_PASSWORD=admin
```

## Tools

| Tool | Description |
|---|---|
| `kc_list_realms` | List all realms |
| `kc_list_clients` | List clients in a realm |
| `kc_list_users` | List users in a realm |

## Roadmap

Realms · Clients · Users · Roles · Groups · Identity Providers · Client Scopes ·
Protocol Mappers · Sessions · Events · Organizations — read + create/update/delete,
plus an optional Streamable HTTP transport for remote use.

## License

[Apache-2.0](LICENSE)
