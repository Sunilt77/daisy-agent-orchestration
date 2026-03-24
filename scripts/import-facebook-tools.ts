import 'dotenv/config';
import { getPrisma } from '../src/platform/prisma';
import { syncPersistentMirrorFromPostgres } from '../src/orchestrator/sqliteMirror';

type ToolDef = {
  name: string;
  description: string;
  type: 'python' | 'http';
  category: string;
  config: Record<string, unknown>;
};

const FB_CATEGORY = 'Facebook Marketing';

const PY_GRAPH_REQUEST = `
import json, os, urllib.parse, urllib.request, urllib.error

def _serialize(v):
    if isinstance(v, (dict, list)):
        return json.dumps(v)
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)

access_token = args.get("access_token") or os.getenv("FB_ACCESS_TOKEN")
if not access_token:
    print(json.dumps({"error": "Missing access token. Provide args.access_token or set FB_ACCESS_TOKEN."}))
    raise SystemExit(1)

api_version = args.get("api_version", "v25.0")
method = str(args.get("method", "GET")).upper()
path = str(args.get("path", "")).lstrip("/")
if not path:
    print(json.dumps({"error": "Missing required arg: path"}))
    raise SystemExit(1)

base = f"https://graph.facebook.com/{api_version}/"
url = path if path.startswith("http") else f"{base}{path}"
params = dict(args.get("params") or {})
payload = dict(args.get("data") or {})

if method in ("GET", "DELETE"):
    params["access_token"] = access_token
    query = urllib.parse.urlencode({k: _serialize(v) for k, v in params.items() if v is not None})
    full_url = f"{url}?{query}" if query else url
    request = urllib.request.Request(full_url, method=method)
else:
    payload["access_token"] = access_token
    body = urllib.parse.urlencode({k: _serialize(v) for k, v in payload.items() if v is not None}).encode("utf-8")
    request = urllib.request.Request(url, data=body, method=method)
    request.add_header("Content-Type", "application/x-www-form-urlencoded")

try:
    with urllib.request.urlopen(request, timeout=30) as resp:
        text = resp.read().decode("utf-8")
        print(text)
except urllib.error.HTTPError as e:
    raw = e.read().decode("utf-8", errors="ignore")
    print(json.dumps({"status": e.code, "error": raw or str(e)}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`.trim();

const tools: ToolDef[] = [
  {
    name: 'fb_graph_request',
    description: 'Generic Facebook Graph API request tool (GET/POST/DELETE) with access token support.',
    type: 'python',
    category: FB_CATEGORY,
    config: { code: PY_GRAPH_REQUEST },
  },
  {
    name: 'fb_list_ad_accounts',
    description: 'List ad accounts for the authenticated Facebook user.',
    type: 'http',
    category: FB_CATEGORY,
    config: {
      method: 'GET',
      url: 'https://graph.facebook.com/{{api_version}}/me/adaccounts',
      headers: {},
      body: '',
      auth: { type: 'bearer', token: '{{access_token}}' },
    },
  },
  {
    name: 'fb_list_campaigns',
    description: 'List campaigns for an ad account (account_id should be act_123...).',
    type: 'http',
    category: FB_CATEGORY,
    config: {
      method: 'GET',
      url: 'https://graph.facebook.com/{{api_version}}/{{account_id}}/campaigns',
      headers: {},
      body: '',
      auth: { type: 'bearer', token: '{{access_token}}' },
    },
  },
  {
    name: 'fb_list_adsets',
    description: 'List ad sets for an ad account.',
    type: 'http',
    category: FB_CATEGORY,
    config: {
      method: 'GET',
      url: 'https://graph.facebook.com/{{api_version}}/{{account_id}}/adsets',
      headers: {},
      body: '',
      auth: { type: 'bearer', token: '{{access_token}}' },
    },
  },
  {
    name: 'fb_list_ads',
    description: 'List ads for an ad account.',
    type: 'http',
    category: FB_CATEGORY,
    config: {
      method: 'GET',
      url: 'https://graph.facebook.com/{{api_version}}/{{account_id}}/ads',
      headers: {},
      body: '',
      auth: { type: 'bearer', token: '{{access_token}}' },
    },
  },
  {
    name: 'fb_get_insights',
    description: 'Fetch insights for an ad account.',
    type: 'http',
    category: FB_CATEGORY,
    config: {
      method: 'GET',
      url: 'https://graph.facebook.com/{{api_version}}/{{account_id}}/insights',
      headers: {},
      body: '',
      auth: { type: 'bearer', token: '{{access_token}}' },
    },
  },
  {
    name: 'fb_create_campaign',
    description: 'Create a campaign under an ad account. Pass campaign fields in args/body.',
    type: 'http',
    category: FB_CATEGORY,
    config: {
      method: 'POST',
      url: 'https://graph.facebook.com/{{api_version}}/{{account_id}}/campaigns',
      headers: { 'Content-Type': 'application/json' },
      body: '',
      auth: { type: 'bearer', token: '{{access_token}}' },
    },
  },
  {
    name: 'fb_create_adset',
    description: 'Create an ad set under an ad account. Pass ad set fields in args/body.',
    type: 'http',
    category: FB_CATEGORY,
    config: {
      method: 'POST',
      url: 'https://graph.facebook.com/{{api_version}}/{{account_id}}/adsets',
      headers: { 'Content-Type': 'application/json' },
      body: '',
      auth: { type: 'bearer', token: '{{access_token}}' },
    },
  },
  {
    name: 'fb_create_ad',
    description: 'Create an ad under an ad account. Pass ad fields in args/body.',
    type: 'http',
    category: FB_CATEGORY,
    config: {
      method: 'POST',
      url: 'https://graph.facebook.com/{{api_version}}/{{account_id}}/ads',
      headers: { 'Content-Type': 'application/json' },
      body: '',
      auth: { type: 'bearer', token: '{{access_token}}' },
    },
  },
  {
    name: 'fb_search_targeting',
    description: 'Search targeting options for an ad account.',
    type: 'http',
    category: FB_CATEGORY,
    config: {
      method: 'GET',
      url: 'https://graph.facebook.com/{{api_version}}/{{account_id}}/targetingsearch',
      headers: {},
      body: '',
      auth: { type: 'bearer', token: '{{access_token}}' },
    },
  },
];

async function upsertTool(tool: ToolDef) {
  const prisma = getPrisma();
  const existing = await prisma.orchestratorTool.findFirst({
    where: { name: tool.name },
    select: { id: true, version: true },
  });
  const cfg = JSON.stringify(tool.config);

  if (existing) {
    const nextVersion = Number(existing.version || 1) + 1;
    await prisma.orchestratorTool.update({
      where: { id: existing.id },
      data: {
        description: tool.description,
        category: tool.category,
        type: tool.type,
        config: cfg,
        version: nextVersion,
        updatedAt: new Date(),
      },
    });
    await prisma.orchestratorToolVersion.create({
      data: {
        toolId: existing.id,
        versionNumber: nextVersion,
        name: tool.name,
        description: tool.description,
        category: tool.category,
        type: tool.type,
        config: cfg,
        changeKind: 'update',
      },
    });
    return { id: existing.id, action: 'updated' as const };
  }

  const created = await prisma.orchestratorTool.create({
    data: {
      name: tool.name,
      description: tool.description,
      category: tool.category,
      type: tool.type,
      config: cfg,
      version: 1,
    },
  });
  await prisma.orchestratorToolVersion.create({
    data: {
      toolId: created.id,
      versionNumber: 1,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      type: tool.type,
      config: cfg,
      changeKind: 'create',
    },
  });
  return { id: created.id, action: 'created' as const };
}

async function main() {
  const results = [];
  for (const tool of tools) {
    results.push({ tool: tool.name, ...(await upsertTool(tool)) });
  }
  await syncPersistentMirrorFromPostgres();
  await getPrisma().$disconnect();
  console.log('Facebook tool pack import complete:');
  for (const row of results) {
    console.log(`- ${row.tool}: ${row.action} (id=${row.id})`);
  }
  console.log('\nTip: Set a credential key like "facebook_marketing" and assign it in each tool auth config dropdown.');
}

main().catch(async (error) => {
  console.error(error);
  await getPrisma().$disconnect().catch(() => undefined);
  process.exit(1);
});
