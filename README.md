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
| `KEYCLOAK_MCP_TOOL_GROUPS` | — | Comma-separated allowlist to register only some tool groups (default: all). Groups: `reads, users, clients, core-writes, realms, roles, groups, scopes, idps, sessions, authn, orgs, ai`. Shrinks the loaded surface while every registered tool stays typed + individually permission-gated |
| `KEYCLOAK_MCP_HTTP_PORT` | — | If set, serve remote Streamable HTTP at `:PORT/mcp` instead of stdio |

### Remote (HTTP) mode — auth

With `KEYCLOAK_MCP_HTTP_PORT` the server runs a stateless Streamable HTTP endpoint at `/mcp`, gated
by a bearer token. Pick a mode:

| Variable | Notes |
|---|---|
| `KEYCLOAK_MCP_OIDC_ISSUER` | **OAuth2 mode (recommended).** Validates the caller's JWT against this issuer's JWKS — e.g. protect the server with the very Keycloak it administers. Serves RFC 9728 Protected Resource Metadata at `/.well-known/oauth-protected-resource`; unauthenticated requests get `401` + `WWW-Authenticate`. |
| `KEYCLOAK_MCP_OIDC_JWKS_URI` | Optional JWKS override (defaults to `<issuer>/protocol/openid-connect/certs`) |
| `KEYCLOAK_MCP_OIDC_AUDIENCE` | Optional expected `aud` |
| `KEYCLOAK_MCP_REQUIRED_ROLE` | Optional realm role the caller must hold (`realm_access.roles`) |
| `KEYCLOAK_MCP_BEARER_TOKEN` | **Static mode.** A shared secret compared in constant time — simple single-caller setups |
| `KEYCLOAK_MCP_PUBLIC_URL` | The externally-visible base URL (used in the metadata document) |

If neither an OIDC issuer nor a static token is set, HTTP mode **binds to `127.0.0.1` only** and
refuses to expose an unauthenticated Keycloak admin endpoint on a public interface.

## Use with Claude Code

```bash
claude mcp add keycloak node /absolute/path/to/keycloak-mcp-server/dist/index.js \
  --env KEYCLOAK_URL=http://localhost:8081 \
  --env KEYCLOAK_ADMIN_USER=admin \
  --env KEYCLOAK_ADMIN_PASSWORD=admin
```

## MCP surface

Full MCP spec, not just tools:

- **Tools** (113) — the complete Keycloak admin API (catalog below).
- **Resources** — read-only state as context: `keycloak://realms`, `keycloak://server-info`, and the
  templates `keycloak://realm/{realm}`, `.../clients`, `.../roles` (the `{realm}` variable
  autocompletes from the live server).
- **Prompts** — guided admin workflows: `audit_realm_security`, `diagnose_login_failures`,
  `onboard_client`, `rotate_client_secret` (realm / clientId arguments autocomplete).
- **Completion** — `completion/complete` for the prompt + resource-template arguments above.
- **Logging** — the `logging` capability is advertised; `logging/setLevel` is honored and each tool
  invocation is logged to the client at the requested level.
- **Tool annotations** — every tool carries `readOnlyHint` / `destructiveHint` / `idempotentHint`, so
  clients can render and gate reads vs. destructive writes differently.
- **Resource subscriptions** — `resources/subscribe` is supported; a subscribed URI is polled and the
  server emits `notifications/resources/updated` when its content changes.
- **Sampling** — `kc_ai_review` asks the connected client's LLM to review a realm's security posture.
- **Elicitation** — `kc_delete_realm_interactive` confirms with the user via `elicitation/create`
  instead of a `confirm` flag. Both degrade gracefully if the client lacks the capability.

### MCP spec coverage

| Area | Status |
|---|---|
| JSON-RPC 2.0, lifecycle, capability negotiation, ping, cancellation | ✅ (SDK) |
| Pagination, progress | ✅ (SDK) |
| Tools · Resources · Prompts · Completion · Logging | ✅ |
| Resource subscriptions (`subscribe` + `resources/updated`) | ✅ |
| Sampling · Elicitation (client features the server uses) | ✅ |
| Transports: stdio · Streamable HTTP | ✅ |
| Authorization: OAuth2 Resource Server on HTTP (RFC 9728) | ✅ |

## Tools

**113 tools** across the full Keycloak admin surface. All write tools are refused when
`KEYCLOAK_MCP_READONLY` is set; every destructive tool (delete/clear/logout/regenerate) is a
**dry-run unless `confirm=true`**.

<details>
<summary>Full tool catalog (113)</summary>

**Core reads** (10)

| Tool | Description |
|---|---|
| `kc_list_realms` | List all realms (name + enabled flag). |
| `kc_get_realm` | Get a realm's configuration summary. |
| `kc_list_clients` | List OAuth clients in a realm. |
| `kc_get_client` | Get a client by its clientId. |
| `kc_list_client_scopes` | List client scopes in a realm. |
| `kc_list_users` | List users in a realm (paged). |
| `kc_get_user` | Get a single user by id or (exact) username. |
| `kc_list_roles` | List realm roles. |
| `kc_list_groups` | List groups in a realm. |
| `kc_list_identity_providers` | List identity providers (SSO / social login) in a realm. |

**Users — core writes** (5)

| Tool | Description |
|---|---|
| `kc_create_user` | Create a user in a realm (optionally set an initial password). |
| `kc_set_user_enabled` | Enable or disable a user. |
| `kc_assign_realm_role` | Assign a realm role to a user. |
| `kc_remove_realm_role` | Remove a realm role from a user. |
| `kc_delete_user` | Delete a user (destructive). Dry-run unless confirm=true. |

**Users — lifecycle & roles** (12)

| Tool | Description |
|---|---|
| `kc_update_user` | Update a user's profile fields; attributes are merged into existing ones. |
| `kc_count_users` | Count users in a realm, optionally filtered. |
| `kc_get_user_sessions` | List a user's active sessions. |
| `kc_logout_user` | Log a user out of ALL sessions (destructive). Dry-run unless confirm=true. |
| `kc_reset_user_password` | Set a user's password (temporary=true forces change on next login). |
| `kc_send_verify_email` | Send the email-verification email to a user. |
| `kc_execute_actions_email` | Email a user a link to perform required actions (e.g. UPDATE_PASSWORD, CONFIGURE_TOTP). |
| `kc_remove_user_from_group` | Remove a user from a group. |
| `kc_list_user_groups` | List the groups a user belongs to. |
| `kc_list_user_role_mappings` | List a user's realm-role and client-role mappings. |
| `kc_assign_client_role` | Assign a client role to a user (client resolved by clientId, role by name). |
| `kc_remove_client_role` | Remove a client role from a user (client resolved by clientId, role by name). |

**Clients — full management** (12)

| Tool | Description |
|---|---|
| `kc_update_client` | Update a client (merge: only provided fields change). |
| `kc_get_client_secret` | Get the current secret of a confidential client. |
| `kc_regenerate_client_secret` | Rotate a client's secret (destructive: old secret stops working). Dry-run unless confirm=true. |
| `kc_get_service_account_user` | Get the service-account user of a client (serviceAccountsEnabled). |
| `kc_add_default_client_scope` | Attach a client scope (by name) as a DEFAULT scope of a client. |
| `kc_remove_default_client_scope` | Detach a DEFAULT client scope (by name) from a client. |
| `kc_add_optional_client_scope` | Attach a client scope (by name) as an OPTIONAL scope of a client. |
| `kc_remove_optional_client_scope` | Detach an OPTIONAL client scope (by name) from a client. |
| `kc_list_client_protocol_mappers` | List protocol mappers of a client. |
| `kc_create_client_protocol_mapper` | Create a protocol mapper on a client (config passed through as-is). |
| `kc_delete_client_protocol_mapper` | Delete a protocol mapper (by name) from a client (destructive). Dry-run unless confirm=true. |
| `kc_list_client_roles` | List roles defined on a client. |

**Clients / roles / groups / scopes — core writes** (9)

| Tool | Description |
|---|---|
| `kc_create_client` | Create an OIDC client in a realm. |
| `kc_delete_client` | Delete a client by clientId (destructive). Dry-run unless confirm=true. |
| `kc_create_realm_role` | Create a realm role. |
| `kc_delete_realm_role` | Delete a realm role by name (destructive). Dry-run unless confirm=true. |
| `kc_create_group` | Create a group in a realm. |
| `kc_delete_group` | Delete a group by id (destructive). Dry-run unless confirm=true. |
| `kc_add_user_to_group` | Add a user to a group. |
| `kc_create_client_scope` | Create a client scope. |
| `kc_delete_client_scope` | Delete a client scope by id (destructive). Dry-run unless confirm=true. |

**Realms** (9)

| Tool | Description |
|---|---|
| `kc_create_realm` | Create a new realm. |
| `kc_update_realm` | Update realm settings (partial RealmRepresentation passthrough). |
| `kc_delete_realm` | Delete a realm and everything in it (destructive). Dry-run unless confirm=true. |
| `kc_get_realm_events_config` | Get a realm's login/admin event logging configuration. |
| `kc_update_realm_events_config` | Update a realm's event logging config (only provided fields change). |
| `kc_clear_realm_cache` | Clear the server-side realm cache (destructive-ish). Dry-run unless confirm=true. |
| `kc_clear_user_cache` | Clear the server-side user cache (destructive-ish). Dry-run unless confirm=true. |
| `kc_get_realm_keys` | List a realm's active key metadata (no key material blobs). |
| `kc_get_server_info` | Get Keycloak server info (version, features, themes). |

**Roles — composites & client roles** (8)

| Tool | Description |
|---|---|
| `kc_update_realm_role` | Update a realm role's description. |
| `kc_get_role_composites` | List the composite (child) roles of a realm role. |
| `kc_add_role_composites` | Add realm roles (by name) as composites of a realm role. |
| `kc_remove_role_composites` | Remove composite roles (by name) from a realm role (destructive). Dry-run unless confirm=true. |
| `kc_list_role_users` | List users holding a realm role. |
| `kc_create_client_role` | Create a role on a client (resolved by clientId). |
| `kc_update_client_role` | Update a client role's description (client resolved by clientId). |
| `kc_delete_client_role` | Delete a client role (destructive; client resolved by clientId). Dry-run unless confirm=true. |

**Groups — members & mappings** (7)

| Tool | Description |
|---|---|
| `kc_get_group` | Get a single group by id, including its direct subgroups. |
| `kc_update_group` | Update a group's name and/or attributes. |
| `kc_list_group_members` | List members of a group (paged). |
| `kc_create_child_group` | Create a child group under a parent group. |
| `kc_add_group_realm_role` | Map a realm role onto a group (members inherit it). |
| `kc_remove_group_realm_role` | Remove a realm-role mapping from a group (destructive). Dry-run unless confirm=true. |
| `kc_list_group_role_mappings` | List a group's role mappings (realm + client roles). |

**Client scopes — mappers & realm defaults** (8)

| Tool | Description |
|---|---|
| `kc_get_client_scope` | Get a client scope by id or name (includes protocol mappers). |
| `kc_update_client_scope` | Update a client scope's name/description/protocol/attributes (locate by scopeId or name). |
| `kc_list_scope_protocol_mappers` | List protocol mappers on a client scope. |
| `kc_create_scope_protocol_mapper` | Add a protocol mapper to a client scope. |
| `kc_delete_scope_protocol_mapper` | Delete a protocol mapper from a client scope (destructive). Dry-run unless confirm=true. |
| `kc_list_realm_default_client_scopes` | List the realm's default and/or optional client scopes (assigned to new clients). |
| `kc_add_realm_default_client_scope` | Add a client scope to the realm's default or optional list (locate by scopeId or name). |
| `kc_remove_realm_default_client_scope` | Remove a client scope from the realm's default or optional list (destructive). Dry-run unless confirm=true. |

**Identity providers** (7)

| Tool | Description |
|---|---|
| `kc_get_idp` | Get a single identity provider by alias (clientSecret masked). |
| `kc_create_idp` | Create an identity provider (e.g. oidc, saml, google, github). |
| `kc_update_idp` | Update an identity provider; config keys are merged into the existing config. |
| `kc_delete_idp` | Delete an identity provider by alias (destructive). Dry-run unless confirm=true. |
| `kc_list_idp_mappers` | List mappers of an identity provider. |
| `kc_create_idp_mapper` | Create a mapper on an identity provider. |
| `kc_delete_idp_mapper` | Delete an identity-provider mapper by id (destructive). Dry-run unless confirm=true. |

**Sessions, events & brute-force** (7)

| Tool | Description |
|---|---|
| `kc_list_admin_events` | List admin (audit) events with optional operation/resource/date filters. |
| `kc_list_login_events` | List user (login) events with optional type/user/date filters. |
| `kc_clear_admin_events` | Clear ALL admin (audit) events in a realm (destructive). Dry-run unless confirm=true. |
| `kc_clear_login_events` | Clear ALL user (login) events in a realm (destructive). Dry-run unless confirm=true. |
| `kc_get_client_session_stats` | Active/offline session counts per client in a realm. |
| `kc_get_brute_force_status` | Brute-force (attack detection) lockout status for a user. |
| `kc_clear_brute_force` | Clear brute-force lockout for one user (userId) or ALL users (destructive). Dry-run unless confirm=true. |

**Authentication flows** (7)

| Tool | Description |
|---|---|
| `kc_list_auth_flows` | List authentication flows in a realm. |
| `kc_get_flow_executions` | List the executions of an authentication flow by flow alias. |
| `kc_list_required_actions` | List required actions registered in a realm. |
| `kc_update_required_action` | Update a required action by alias (merge: only provided fields change). |
| `kc_lower_required_action_priority` | Move a required action one position down in the priority order. |
| `kc_copy_auth_flow` | Copy an authentication flow (by source alias) to a new flow name. |
| `kc_delete_auth_flow` | Delete a non-built-in authentication flow by id (destructive). Dry-run unless confirm=true. |

**Organizations & components** (10)

| Tool | Description |
|---|---|
| `kc_list_organizations` | List organizations in a realm, optionally filtered by search text. |
| `kc_get_organization` | Get one organization by id. |
| `kc_create_organization` | Create an organization with a name and one or more email domains. |
| `kc_delete_organization` | Delete an organization by id (destructive). Dry-run unless confirm=true. |
| `kc_list_org_members` | List members of an organization. |
| `kc_add_org_member` | Add an existing realm user to an organization. |
| `kc_remove_org_member` | Remove a user from an organization (destructive). Dry-run unless confirm=true. |
| `kc_list_components` | List realm components (user federation, key providers), filterable by provider type. |
| `kc_get_component` | Get one component by id, including its config. |
| `kc_delete_component` | Delete a component by id (destructive). Dry-run unless confirm=true. |

**Sampling & elicitation** (2)

| Tool | Description |
|---|---|
| `kc_ai_review` | Ask the connected client's LLM to review a realm's security posture (MCP sampling). Read-only. |
| `kc_delete_realm_interactive` | Delete a realm, confirming via MCP elicitation (asks the user directly — no confirm arg). Refused in read-only mode. |

</details>

## Roadmap

- **Credential flows:** BCrypt hash-import for app migrations.
- **Sampling / elicitation** for interactive, confirmation-gated write workflows.

## License

[Apache-2.0](LICENSE)
