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
| `KEYCLOAK_MCP_READONLY` | — | Set `true`/`1` to refuse all write tools |
| `KEYCLOAK_MCP_HTTP_PORT` | — | If set, serve remote Streamable HTTP at `:PORT/mcp` instead of stdio |

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
| `kc_get_realm` | Get a realm's configuration summary |
| `kc_list_clients` | List clients in a realm |
| `kc_get_client` | Get a client by its clientId |
| `kc_list_client_scopes` | List client scopes in a realm |
| `kc_list_users` | List users in a realm |
| `kc_get_user` | Get a user by id or exact username |
| `kc_list_roles` | List realm roles |
| `kc_list_groups` | List groups in a realm |
| `kc_list_identity_providers` | List identity providers (SSO) in a realm |

### Write tools

Refused when `KEYCLOAK_MCP_READONLY` is set; `kc_delete_user` is a dry-run unless `confirm=true`.

| Tool | Description |
|---|---|
| `kc_create_user` | Create a user (optionally set an initial password) |
| `kc_set_user_enabled` | Enable/disable a user |
| `kc_assign_realm_role` | Assign a realm role to a user |
| `kc_remove_realm_role` | Remove a realm role from a user |
| `kc_delete_user` | Delete a user (dry-run unless `confirm=true`) |

## Roadmap

- **More writes:** clients, roles, groups, client scopes; reset-password flows.
- **More resources:** sessions, events, protocol mappers, organizations.
- **Transport:** optional Streamable HTTP for remote use (today: stdio).

## License

[Apache-2.0](LICENSE)
