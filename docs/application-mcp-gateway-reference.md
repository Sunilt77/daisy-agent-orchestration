# Application MCP Gateway Reference

This guide describes how an application-owned MCP gateway should validate and execute delegated tool calls from the orchestrator in a multi-tenant setup.

## Required Contract

Incoming request from orchestrator:

- Header: `Authorization: Bearer <delegated_tool_token>`
- Header: `X-Orchestrator-Request-Id`
- Header: `Idempotency-Key`
- Body:
  - `tool_name`
  - `arguments`
  - `context.execution_context_id`
  - `context.tenant_external_id`
  - `context.user_external_id`
  - `context.session_id`
  - `context.conversation_id`
  - `context.credential_refs`

## Validation Checklist

1. Verify delegated token signature and expiry.
2. Enforce `aud` equals your configured gateway audience.
3. Enforce `allowed_tool` matches requested `tool_name`.
4. Ensure `tenant_external_id` and `user_external_id` in body match token claims.
5. Enforce scope requirements before calling internal APIs.
6. Resolve credentials only from your application-side credential vault.
7. Use idempotency key for write operations.
8. Emit audit logs keyed by `request_id` and `execution_context_id`.

## Minimal Express Example

```ts
import express from 'express';
import { verifyDelegatedToolToken } from '../src/platform/executionContext';

const app = express();
app.use(express.json());

app.post('/mcp/gateway/tool-call', async (req, res) => {
  try {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
    if (!token) return res.status(401).json({ ok: false, error: 'Missing bearer token' });

    const claims = verifyDelegatedToolToken(token, {
      expectedAudience: process.env.DELEGATED_TOOL_TOKEN_AUDIENCE || 'app-mcp-gateway',
    });

    const toolName = String(req.body?.tool_name || '').trim();
    if (!toolName) return res.status(400).json({ ok: false, error: 'tool_name is required' });
    if (claims.allowed_tool !== toolName) {
      return res.status(403).json({ ok: false, error: 'Tool not allowed by delegated token' });
    }

    const tenantExternalId = String(req.body?.context?.tenant_external_id || '');
    const userExternalId = String(req.body?.context?.user_external_id || '');
    if (tenantExternalId !== claims.tenant_external_id || userExternalId !== claims.user_external_id) {
      return res.status(403).json({ ok: false, error: 'Subject mismatch' });
    }

    // Enforce scopes before dispatching the application API call.
    const scopes = new Set(claims.required_scopes || []);
    if (toolName === 'crm.create_lead' && !scopes.has('crm.leads:write')) {
      return res.status(403).json({ ok: false, error: 'Missing required scope crm.leads:write' });
    }

    // Lookup app-side credentials by claims.credential_refs here.
    const output = { accepted: true, tool: toolName, tenant: tenantExternalId };

    return res.status(200).json({ ok: true, output });
  } catch (error: any) {
    return res.status(401).json({ ok: false, error: error?.message || 'Unauthorized' });
  }
});
```

## Credential Strategy

- Keep credentials in the application environment only.
- Treat `credential_refs` as stable lookup keys, not raw secrets.
- Bind `credential_refs` to `(tenant_external_id, user_external_id)` when applicable.
- Rotate provider keys independently from orchestrator tokens.

## Scale Patterns

- Use a stateless gateway deployment behind a load balancer.
- Store idempotency records in Redis or Postgres with short TTL.
- Apply per-tenant rate limiting and concurrency controls.
- Include `request_id`, `execution_context_id`, and tenant/user ids in logs and traces.
