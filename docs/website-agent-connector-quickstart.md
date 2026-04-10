# Website Agent Connector Quickstart (User-Friendly)

This guide shows the simplest way to expose orchestrator agents in any website.

Use this when you want:

- app users to chat with orchestrator agents from your website UI
- tenant/user authorization to stay in your app backend
- MCP tools to execute safely through your app-owned gateway

## Integration Pattern

Do not call orchestrator directly from browser clients.

Use this flow:

1. Browser sends chat to your app backend.
2. App backend authenticates user and resolves tenant/user identity.
3. App backend creates a short-lived execution context token from orchestrator.
4. App backend forwards chat to orchestrator v2 chat endpoint.
5. App backend returns answer (or streams tokens/events) to browser.

## 10-Minute Backend Example (Node + Express)

```ts
import express from 'express';

const app = express();
app.use(express.json());

const ORCHESTRATOR_BASE_URL = process.env.ORCHESTRATOR_BASE_URL || 'http://localhost:3000';
const ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY || '';
const CONNECTED_APPLICATION_ID = process.env.CONNECTED_APPLICATION_ID || '';
const DEFAULT_AGENT_ID = Number(process.env.DEFAULT_AGENT_ID || 0);

async function createExecutionContext(opts: {
  tenantExternalId: string;
  userExternalId: string;
  conversationId?: string;
}) {
  const res = await fetch(`${ORCHESTRATOR_BASE_URL}/api/v2/execution-contexts`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ORCHESTRATOR_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      application_id: CONNECTED_APPLICATION_ID,
      tenant_external_id: opts.tenantExternalId,
      user_external_id: opts.userExternalId,
      conversation_id: opts.conversationId || null,
      ttl_seconds: 600,
    }),
  });
  if (!res.ok) throw new Error(`Execution context failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

app.post('/api/agent/chat', async (req, res) => {
  try {
    // Replace with your real app auth/session middleware:
    const tenantExternalId = String(req.header('x-tenant-id') || 'tenant-demo');
    const userExternalId = String(req.header('x-user-id') || 'user-demo');
    const message = String(req.body?.message || '').trim();
    const sessionId = String(req.body?.session_id || '');
    const conversationId = String(req.body?.conversation_id || '');

    if (!message) return res.status(400).json({ ok: false, error: 'message is required' });
    if (!DEFAULT_AGENT_ID) return res.status(500).json({ ok: false, error: 'DEFAULT_AGENT_ID not configured' });

    const executionContext = await createExecutionContext({
      tenantExternalId,
      userExternalId,
      conversationId: conversationId || undefined,
    });

    const runRes = await fetch(`${ORCHESTRATOR_BASE_URL}/api/v2/agent-runs/chat`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ORCHESTRATOR_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        agent_id: DEFAULT_AGENT_ID,
        message,
        session_id: sessionId || undefined,
        execution_context_token: executionContext.execution_context_token,
      }),
    });

    const payloadText = await runRes.text();
    if (!runRes.ok) {
      return res.status(runRes.status).json({ ok: false, error: payloadText });
    }
    const payload = JSON.parse(payloadText);
    return res.json({
      ok: true,
      session_id: payload.session_id,
      response: payload.response || payload.text || '',
      usage: payload.usage || null,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error?.message || 'Chat failed' });
  }
});
```

## 3-Minute Frontend Example (Simple Fetch)

```ts
async function chatWithAgent(message: string, sessionId?: string) {
  const res = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message,
      session_id: sessionId || null,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Chat request failed');
  return data as { session_id: string; response: string; usage?: any };
}
```

## Required Orchestrator Setup (Once Per Website/App)

1. Create a Connected Application in orchestrator (`/api/v2/applications`).
2. Create/register MCP gateway records for that app (`/api/v2/mcp/gateways`).
3. Assign tools/agents to the app according to tenant policy.
4. Store these in your app backend config:
   - `ORCHESTRATOR_BASE_URL`
   - `ORCHESTRATOR_API_KEY` (server-side only)
   - `CONNECTED_APPLICATION_ID`
   - `DEFAULT_AGENT_ID`

## Multi-Tenant Checklist

- Always pass `tenant_external_id` and `user_external_id` from app auth.
- Keep execution context TTL short (for example 5-15 minutes).
- Do not expose orchestrator API key in browser.
- Keep MCP gateway secrets only in your app platform.
- Add per-tenant rate limits in your backend route.

## Scale Recommendations

- Use `/api/v2/agent-runs/chat/stream` for better UX on long responses.
- Cache `session_id` in browser per conversation.
- Use Redis-backed rate limiting in your app backend.
- Keep orchestrator autoscaling + Redis enabled in production.

## Troubleshooting

- 401 from execution contexts: verify orchestrator bearer key and audience settings.
- 403 on tool call: app MCP gateway scope check is denying action.
- Slow first request: expected after deploy/cold start; keep prewarm enabled.
