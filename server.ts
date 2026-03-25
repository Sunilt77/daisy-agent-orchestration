import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer, ViteDevServer } from 'vite';
import { initDb } from './src/db';
import db from './src/db';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { agentops } from 'agentops';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import JSON5 from 'json5';
import { withRetry } from './src/utils/withRetry';
import cookieParser from 'cookie-parser';
import { registerPlatformRoutes } from './src/platform/routes';
import { closePrisma, getPrisma } from './src/platform/prisma';
import { closeRedis, initRedis, isRedisConnected } from './src/infra/redis';
import { getSqlitePath } from './src/db';
import { startSqliteGcsSyncLoop, syncSqliteToGcs } from './src/infra/sqliteGcs';
import { randomTraceIdHex32, uuid } from './src/platform/crypto';
import { verifyProjectApiKey } from './src/platform/apiKeys';
import { syncPersistentMirrorFromPostgres } from './src/orchestrator/sqliteMirror';
import {
  claimNextJob as claimNextRuntimeJob,
  collectExecutionUsage as collectRuntimeExecutionUsage,
  createAgentExecution as createRuntimeAgentExecution,
  createDelegatedParentExecution as createRuntimeDelegatedParentExecution,
  createToolExecution as createRuntimeToolExecution,
  createWorkflowRun as createRuntimeWorkflowRun,
  ensureAgentSession as ensureRuntimeAgentSession,
  finalizeSupervisorExecution as finalizeRuntimeSupervisorExecution,
  getAgentExecution as getRuntimeAgentExecution,
  getDelegationRows as getRuntimeDelegationRows,
  getJobRow as getRuntimeJobRow,
  getWorkflowRun as getRuntimeWorkflowRun,
  loadSessionConversation as loadRuntimeSessionConversation,
  loadSessionSummary as loadRuntimeSessionSummary,
  persistWorkflowRun as persistRuntimeWorkflowRun,
  recoverRuntimeState,
  saveSessionConversation as saveRuntimeSessionConversation,
  saveSessionSummary as saveRuntimeSessionSummary,
  updateAgentExecution as updateRuntimeAgentExecution,
  updateJobResult as updateRuntimeJobResult,
  updateToolExecution as updateRuntimeToolExecution,
  waitForJob as waitForRuntimeJob,
  enqueueJob as enqueueRuntimeJob,
} from './src/orchestrator/runtimeStore';
import { spawn } from 'child_process';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import path from 'path';
import { fileURLToPath } from 'url';
import * as internalTools from './src/orchestrator/internalTools.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);

type CancelToken = { canceled: boolean; reason?: string };
type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'canceled';

// pricing logic moved inside startServer


// Initialize AgentOps
if (process.env.AGENTOPS_API_KEY) {
    try {
        agentops.init({ apiKey: process.env.AGENTOPS_API_KEY });
        console.log('AgentOps initialized');
    } catch (e) {
        console.error('Failed to initialize AgentOps:', e);
    }
}

const tracer = trace.getTracer('ai-orchestrator');

const SETTINGS_KEY_PLATFORM_INGEST_PROJECT_ID = 'platform_ingest_project_id';
const SETTINGS_KEY_MCP_AUTH_TOKEN = 'mcp_auth_token';
const SETTINGS_KEY_PLATFORM_ACCESS_CONTROLS = 'platform_access_controls_v1';
function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
  return row?.value ?? null;
}
import { refreshPersistentMirror } from './src/orchestrator/sqliteMirror.js';

async function setSetting(key: string, value: string | null) {
  const prisma = getPrisma();
  if (value == null) {
    await prisma.orchestratorSetting.deleteMany({ where: { key } });
  } else {
    await prisma.orchestratorSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
  await refreshPersistentMirror();
}

function requireMcpAuth(req: express.Request, res: express.Response): boolean {
  const token = getSetting(SETTINGS_KEY_MCP_AUTH_TOKEN);
  if (!token) return true;
  const auth = req.header('authorization') || '';
  const bearer = auth.match(/^Bearer\\s+(.+)$/i)?.[1]?.trim();
  const apiKey = req.header('x-api-key') || req.header('X-API-Key');
  if (bearer === token || apiKey === token) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

function getPlatformProjectIdForLocalProject(localProjectId: number | null | undefined): string | null {
  if (!localProjectId) return null;
  const row = db.prepare('SELECT platform_project_id FROM project_links WHERE project_id = ?').get(localProjectId) as any;
  return row?.platform_project_id ?? null;
}

type RuntimeAccessPolicy = {
  agents_mode: 'all' | 'none' | 'allowlist';
  allowed_agent_ids: number[];
  tools_mode: 'all' | 'none' | 'allowlist';
  mcp_mode: 'all' | 'none' | 'allowlist';
  allowed_tool_ids: number[];
  allowed_mcp_tool_ids: number[];
  allowed_mcp_bundle_ids: number[];
};

function getRuntimeAccessPolicy(orgId?: string | null): RuntimeAccessPolicy {
  const defaults: RuntimeAccessPolicy = {
    agents_mode: 'all',
    allowed_agent_ids: [],
    tools_mode: 'all',
    mcp_mode: 'all',
    allowed_tool_ids: [],
    allowed_mcp_tool_ids: [],
    allowed_mcp_bundle_ids: [],
  };
  const raw = getSetting(SETTINGS_KEY_PLATFORM_ACCESS_CONTROLS);
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    const global = parsed?.global && typeof parsed.global === 'object' ? parsed.global : {};
    const tenant = orgId && parsed?.tenants && typeof parsed.tenants === 'object' ? (parsed.tenants[orgId] || {}) : {};
    const resolved = { ...global, ...tenant };
    const asMode = (value: any, fallback: any) =>
      value === 'all' || value === 'none' || value === 'allowlist' ? value : fallback;
    const asAgentsMode = (value: any, fallback: any) =>
      value === 'all' || value === 'none' || value === 'allowlist' ? value : fallback;
    const asIds = (input: any) =>
      Array.isArray(input)
        ? Array.from(new Set(input.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)))
        : [];
    return {
      agents_mode: asAgentsMode(resolved.agents_mode, 'all'),
      allowed_agent_ids: asIds(resolved.allowed_agent_ids),
      tools_mode: asMode(resolved.tools_mode, 'all'),
      mcp_mode: asMode(resolved.mcp_mode, 'all'),
      allowed_tool_ids: asIds(resolved.allowed_tool_ids),
      allowed_mcp_tool_ids: asIds(resolved.allowed_mcp_tool_ids),
      allowed_mcp_bundle_ids: asIds(resolved.allowed_mcp_bundle_ids),
    };
  } catch {
    return defaults;
  }
}

function buildSystemPrompt(agent: { name?: string; role?: string; goal?: string; backstory?: string }) {
  const name = agent.name || 'Agent';
  const role = agent.role || 'assistant';
  const goal = agent.goal || '';
  const backstory = agent.backstory || '';
  return [
    `You are ${name}, a ${role}.`,
    goal ? `Goal: ${goal}` : '',
    backstory ? `Backstory: ${backstory}` : '',
    'You must respond with valid JSON only. Do not add markdown formatting.',
  ].filter(Boolean).join('\n');
}

function normalizeNumber(value: any): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getRetryConfig(policy?: string | null): { maxRetries: number; baseDelayMs: number } {
  switch ((policy || '').toLowerCase()) {
    case 'none':
      return { maxRetries: 1, baseDelayMs: 0 };
    case 'aggressive':
      return { maxRetries: Number(process.env.AGGRESSIVE_RETRY_MAX_RETRIES) || 7, baseDelayMs: Number(process.env.AGGRESSIVE_RETRY_BASE_DELAY_MS) || 500 };
    case 'relaxed':
      return { maxRetries: Number(process.env.RELAXED_RETRY_MAX_RETRIES) || 3, baseDelayMs: Number(process.env.RELAXED_RETRY_BASE_DELAY_MS) || 2500 };
    default:
      return { maxRetries: Number(process.env.RETRY_MAX_RETRIES) || 5, baseDelayMs: Number(process.env.RETRY_BASE_DELAY_MS) || 2000 };
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

const JOB_CONCURRENCY = Number(process.env.JOB_CONCURRENCY) || 2;
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS) || 120000;
let workerTimer: NodeJS.Timeout | null = null;
let workerRunning = 0;
const agentCancelTokens = new Map<number, CancelToken>();
const crewCancelTokens = new Map<number, CancelToken>();
const delegatedExecutionPromises = new Map<number, Promise<void>>();

function getCancelToken(map: Map<number, CancelToken>, id: number) {
  const existing = map.get(id);
  if (existing) return existing;
  const token = { canceled: false } as CancelToken;
  map.set(id, token);
  return token;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonObject(value: any): any {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function getJobRow(jobId: number) {
  return await getRuntimeJobRow(jobId) as
    | { id: number; status: JobStatus; result: string | null; error: string | null }
    | undefined;
}

async function getDelegationRows(parentExecutionId: number) {
  return await getRuntimeDelegationRows(parentExecutionId);
}

function summarizeDelegationResults(rows: any[]) {
  return rows.map((row, index) => {
    const result = String(row.result || '').trim();
    const error = String(row.error || '').trim();
    return [
      `Delegate ${index + 1}: ${row.title || row.agent_name || `Agent ${row.agent_id}`}`,
      `Agent ID: ${row.agent_id}`,
      `Status: ${row.status}`,
      `Task: ${String(row.task || '').trim() || 'n/a'}`,
      result ? `Result:\n${result}` : (error ? `Error:\n${error}` : 'Result:\nNo result returned.'),
    ].join('\n');
  }).join('\n\n');
}

async function finalizeSupervisorExecution(parentExecutionId: number, status: 'completed' | 'failed' | 'canceled', output: string, totalUsage?: { prompt_tokens: number; completion_tokens: number; cost: number }) {
  await finalizeRuntimeSupervisorExecution(parentExecutionId, status, output, totalUsage);
}

async function createDelegatedParentExecution(options: {
  supervisorAgentId: number;
  task: string;
  delegates: Array<{ agentId: number; task: string; title?: string | null }>;
  synthesisAgentId?: number | null;
  synthesize?: boolean;
  source?: string;
}) {
  const {
    supervisorAgentId,
    task,
    delegates,
    synthesisAgentId,
    synthesize = true,
    source = 'delegated_execution',
  } = options;
  return await createRuntimeDelegatedParentExecution({
    supervisorAgentId,
    task,
    delegates,
    synthesisAgentId,
    synthesize,
    source,
  });
}

async function startDelegatedExecution(options: {
  supervisorAgent: any;
  task: string;
  delegates: Array<{ agentId: number; task: string; title?: string | null }>;
  synthesisAgentId?: number | null;
  synthesize?: boolean;
  sessionId?: string;
  userId?: string;
  source?: string;
}) {
  const parentExecutionId = await createDelegatedParentExecution({
    supervisorAgentId: Number(options.supervisorAgent.id),
    task: options.task,
    delegates: options.delegates,
    synthesisAgentId: options.synthesisAgentId ?? null,
    synthesize: options.synthesize !== false,
    source: options.source || 'delegated_execution',
  });
  const workflow = runDelegatedAgentExecution({
    supervisorAgent: options.supervisorAgent,
    parentExecutionId,
    task: options.task,
    delegates: options.delegates,
    synthesisAgentId: options.synthesisAgentId ?? null,
    synthesize: options.synthesize !== false,
    sessionId: options.sessionId,
    userId: options.userId,
  });
  delegatedExecutionPromises.set(parentExecutionId, workflow.then(() => undefined));
  return { parentExecutionId, workflow };
}

async function cascadeCancelDelegatedChildren(parentExecutionId: number, reason: string) {
  const rows = await getDelegationRows(parentExecutionId);
  for (const row of rows) {
    const childExecId = Number(row.child_execution_id || 0);
    if (childExecId > 0) {
      const token = getCancelToken(agentCancelTokens, childExecId);
      token.canceled = true;
      token.reason = reason;
      await updateRuntimeAgentExecution(childExecId, { status: 'canceled' });
    }
    const childJobId = Number(row.child_job_id || 0);
    if (childJobId > 0) {
      await updateRuntimeJobResult(childJobId, 'canceled', null, reason);
    }
    await getPrisma().orchestratorAgentDelegation.update({
      where: { id: Number(row.id) },
      data: {
        status: ['completed', 'failed', 'canceled'].includes(String(row.status)) ? String(row.status) : 'canceled',
        error: String(row.error || '').trim() ? row.error : reason,
        updatedAt: new Date(),
      },
    });
  }
}

type AgentSessionRow = { id: string; user_id: string | null };

async function ensureAgentSession(agentId: number, sessionId?: string, userId?: string): Promise<AgentSessionRow> {
  return await ensureRuntimeAgentSession(agentId, sessionId, userId);
}

async function loadSessionConversation(sessionId: string): Promise<Array<{ role: string; content: string; ts?: string }>> {
  return await loadRuntimeSessionConversation(sessionId);
}

async function loadSessionSummary(sessionId: string): Promise<string> {
  return await loadRuntimeSessionSummary(sessionId);
}

async function saveSessionConversation(sessionId: string, messages: Array<{ role: string; content: string; ts?: string }>) {
  await saveRuntimeSessionConversation(sessionId, messages);
}

async function saveSessionSummary(sessionId: string, summary: string) {
  await saveRuntimeSessionSummary(sessionId, summary);
}

function formatConversation(messages: Array<{ role: string; content: string; ts?: string }>): string {
  if (!messages.length) return '';
  return messages.map(m => `${m.role}: ${m.content}`).join('\n');
}

type WorkflowGraphNode = {
  id: string;
  type?: string;
  data?: Record<string, any>;
};

type WorkflowGraphEdge = {
  id?: string;
  source: string;
  target: string;
};

type WorkflowGraph = {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
};

function parseWorkflowGraph(value: any): WorkflowGraph {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
    const edges = Array.isArray(parsed?.edges) ? parsed.edges : [];
    return { nodes, edges };
  } catch {
    return { nodes: [], edges: [] };
  }
}

function safeJsonParse<T = any>(value: any, fallback: T): T {
  try {
    if (typeof value !== 'string' || !value.trim()) return fallback;
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeWorkflowGraph(graph: WorkflowGraph): WorkflowGraph {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes.filter((node) => node && typeof node.id === 'string') : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(graph?.edges)
    ? graph.edges.filter((edge) => edge && nodeIds.has(edge.source) && nodeIds.has(edge.target))
    : [];
  return { nodes, edges };
}

function workflowTemplateArgs(input: any, nodeOutputs: Record<string, any>, last: any, extra: Record<string, any> = {}) {
  return { input, nodes: nodeOutputs, last, ...extra };
}

function renderWorkflowTemplate(template: any, input: any, nodeOutputs: Record<string, any>, last: any, extra: Record<string, any> = {}) {
  const text = String(template || '').trim();
  if (!text) return '';
  return applyTemplate(text, workflowTemplateArgs(input, nodeOutputs, last, extra));
}

function parseWorkflowArgs(template: any, input: any, nodeOutputs: Record<string, any>, last: any, extra: Record<string, any> = {}) {
  const rendered = renderWorkflowTemplate(template, input, nodeOutputs, last, extra);
  if (!rendered) return {};
  try {
    return JSON.parse(rendered);
  } catch {
    try {
      return JSON5.parse(rendered);
    } catch {
      return { value: rendered };
    }
  }
}

function parseWorkflowList(template: any, input: any, nodeOutputs: Record<string, any>, last: any) {
  const rendered = renderWorkflowTemplate(template, input, nodeOutputs, last);
  if (!rendered) return [];
  try {
    const parsed = JSON.parse(rendered);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.items)) return parsed.items;
  } catch {
    // fall back to text splitting
  }
  return String(rendered)
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function appendWorkflowRunLog(logs: any[], type: string, payload: any) {
  logs.push({
    ts: new Date().toISOString(),
    type,
    payload,
  });
  return logs;
}

async function persistWorkflowRun(runId: number, status: string, output: any, logs: any[]) {
  await persistRuntimeWorkflowRun(runId, status, output, logs);
}

async function createWorkflowRun(workflowId: number, triggerType: string, input: any, graph: string) {
  return await createRuntimeWorkflowRun(workflowId, triggerType, input, graph);
}

async function runWorkflowExecution(runId: number): Promise<{ run_id: number; status: string; output: any }> {
  const run = await getRuntimeWorkflowRun(runId);
  if (!run) throw new Error('Workflow run not found');
  const workflow = await getPrisma().orchestratorWorkflow.findUnique({ where: { id: run.workflow_id } });
  if (!workflow) throw new Error('Workflow not found');

  const graph = normalizeWorkflowGraph(parseWorkflowGraph(run.graph_snapshot || workflow.graph));
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, WorkflowGraphEdge[]>();
  const incoming = new Set<string>();
  for (const edge of graph.edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source)!.push(edge);
    incoming.add(edge.target);
  }

  const startNodes = graph.nodes.filter((node) => {
    const type = String(node.type || node.data?.kind || '').toLowerCase();
    return type === 'trigger' || !incoming.has(node.id);
  });
  if (!startNodes.length) {
    const logs = appendWorkflowRunLog([], 'error', { message: 'Workflow has no start node' });
    await persistWorkflowRun(runId, 'failed', { error: 'Workflow has no start node' }, logs);
    throw new Error('Workflow has no start node');
  }

  const input = safeJsonParse<any>(run.input, {});
  const logs: any[] = [];
  const nodeOutputs: Record<string, any> = {};
  const queue = startNodes.map((node) => node.id);
  const processed = new Set<string>();
  let finalOutput: any = null;
  let lastOutput: any = input;
  let steps = 0;
  await persistWorkflowRun(runId, 'running', null, logs);

  while (queue.length && steps < 100) {
    const nodeId = queue.shift()!;
    if (processed.has(nodeId)) continue;
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    processed.add(nodeId);
    steps += 1;

    const type = String(node.type || node.data?.kind || '').toLowerCase();
    const data = node.data || {};
    appendWorkflowRunLog(logs, 'node_start', { node_id: nodeId, type, label: data.label || data.name || nodeId });
    await persistWorkflowRun(runId, 'running', finalOutput || lastOutput || null, logs);

    let nodeResult: any = null;
    if (type === 'trigger') {
      nodeResult = { input };
    } else if (type === 'agent') {
      const agentId = Number(data.agentId);
      const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;
      if (!agent) throw new Error(`Workflow agent node references missing agent ${agentId}`);
      const taskText = renderWorkflowTemplate(
        data.prompt || data.task || 'Handle the workflow input: {{input.message}}',
        input,
        nodeOutputs,
        lastOutput
      ) || 'Handle the workflow input.';
      const jobId = await enqueueJob('run_agent', {
        agentId,
        task: taskText,
        initiatedBy: 'workflow_node',
      });
      const result = await waitForJob(jobId, 120000);
      nodeResult = {
        text: result?.result ?? '',
        execution_id: result?.exec_id ?? null,
        usage: result?.usage ?? null,
      };
    } else if (type === 'crew') {
      const crewId = Number(data.crewId);
      if (!Number.isFinite(crewId) || crewId <= 0) throw new Error('Workflow crew node references missing crew');
      const crew = db.prepare('SELECT * FROM crews WHERE id = ?').get(crewId) as any;
      if (!crew) throw new Error(`Workflow crew node references missing crew ${crewId}`);
      const initialInput = renderWorkflowTemplate(
        data.prompt || data.task || '{{input.message}}',
        input,
        nodeOutputs,
        lastOutput
      ) || '';
      const execInfo = db.prepare(`
        INSERT INTO crew_executions (crew_id, status, initial_input, retry_of, logs)
        VALUES (?, 'running', ?, NULL, '[]')
      `).run(crewId, initialInput);
      const executionId = Number(execInfo.lastInsertRowid);
      await runCrewExecution(
        crewId,
        executionId,
        initialInput,
        { initiatedBy: 'workflow_node_crew' }
      );
      const crewExecution = db.prepare('SELECT status FROM crew_executions WHERE id = ?').get(executionId) as any;
      const crewLogs = readCrewExecutionLogs(executionId);
      nodeResult = {
        text: extractCrewFinalResult(crewLogs),
        execution_id: executionId,
        status: crewExecution?.status || 'completed',
      };
    } else if (type === 'loop') {
      const items = parseWorkflowList(
        data.itemsTemplate || data.items || '{{input.items}}',
        input,
        nodeOutputs,
        lastOutput
      );
      const joinWith = typeof data.joinWith === 'string' ? data.joinWith : '\n';
      const renderedItems = items.map((item, index) => (
        renderWorkflowTemplate(
          data.itemTemplate || '{{item}}',
          input,
          nodeOutputs,
          lastOutput,
          { item, index, item_index: index }
        )
      ));
      nodeResult = {
        count: renderedItems.length,
        items: renderedItems,
        text: renderedItems.join(joinWith),
      };
    } else if (type === 'tool') {
      const toolId = Number(data.toolId);
      const tool = Number.isFinite(toolId) && toolId > 0
        ? db.prepare('SELECT * FROM tools WHERE id = ?').get(toolId) as any
        : db.prepare('SELECT * FROM tools WHERE name = ?').get(String(data.toolName || '')) as any;
      if (!tool) throw new Error(`Workflow tool node references a missing tool`);
      const args = parseWorkflowArgs(data.argsTemplate || data.args || '{}', input, nodeOutputs, lastOutput);
      const result = await executeTool(tool.name, args, undefined, tool);
      nodeResult = { text: result, tool_id: tool.id, tool_name: tool.name, args };
    } else if (type === 'condition') {
      const left = renderWorkflowTemplate(data.left || '{{last.text}}', input, nodeOutputs, lastOutput);
      const right = renderWorkflowTemplate(data.right || '', input, nodeOutputs, lastOutput);
      const operator = String(data.operator || 'contains').toLowerCase();
      let passed = false;
      if (operator === 'equals') passed = left === right;
      else if (operator === 'not_equals') passed = left !== right;
      else if (operator === 'truthy') passed = Boolean(left && left !== 'false' && left !== '0');
      else passed = String(left || '').toLowerCase().includes(String(right || '').toLowerCase());
      nodeResult = { passed, left, right, operator };
    } else if (type === 'output') {
      const text = renderWorkflowTemplate(data.template || '{{last.text}}', input, nodeOutputs, lastOutput);
      nodeResult = { text };
      finalOutput = nodeResult;
    } else {
      nodeResult = { value: renderWorkflowTemplate(data.template || '{{last.text}}', input, nodeOutputs, lastOutput) };
    }

    nodeOutputs[nodeId] = nodeResult;
    lastOutput = nodeResult;
    appendWorkflowRunLog(logs, 'node_complete', {
      node_id: nodeId,
      type,
      output_preview: compactPromptText(
        typeof nodeResult === 'string' ? nodeResult : JSON.stringify(nodeResult),
        320
      ),
    });
    await persistWorkflowRun(runId, 'running', finalOutput || lastOutput || null, logs);

    const nextEdges = outgoing.get(nodeId) || [];
    let nextNodeIds = nextEdges.map((edge) => edge.target);
    if (type === 'condition' && nextNodeIds.length > 1) {
      nextNodeIds = nodeResult?.passed ? [nextNodeIds[0]] : [nextNodeIds[1]];
    }
    for (const nextId of nextNodeIds) {
      if (!processed.has(nextId)) queue.push(nextId);
    }
  }

  if (steps >= 100) {
    appendWorkflowRunLog(logs, 'warning', { message: 'Workflow stopped after reaching the node safety limit.' });
  }

  const output = finalOutput || lastOutput || { input };
  await persistWorkflowRun(runId, 'completed', output, logs);
  return { run_id: runId, status: 'completed', output };
}

function normalizePromptText(text: any): string {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function compactPromptText(text: any, maxChars: number): string {
  const normalized = normalizePromptText(text);
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 24)).trim()} [truncated]`;
}

function formatRecentConversation(messages: Array<{ role: string; content: string; ts?: string }>, recentCount = 4): string {
  const recent = messages.slice(-Math.max(1, recentCount));
  return recent
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${compactPromptText(m.content, 420)}`)
    .filter(Boolean)
    .join('\n');
}

function mergeConversationSummary(existingSummary: string, overflowMessages: Array<{ role: string; content: string; ts?: string }>) {
  const existingLines = String(existingSummary || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const newLines = overflowMessages
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${compactPromptText(m.content, 180)}`)
    .filter(Boolean);
  const merged = [...existingLines, ...newLines];
  const deduped: string[] = [];
  for (const line of merged) {
    if (!deduped.length || deduped[deduped.length - 1] !== line) {
      deduped.push(line);
    }
  }
  return deduped.slice(-12).join('\n');
}

function buildMemoryContext(summary: string, recentMessages: Array<{ role: string; content: string; ts?: string }>) {
  const sections: string[] = [];
  const compactSummary = compactPromptText(summary, 1400);
  if (compactSummary) sections.push(`Conversation summary:\n${compactSummary}`);
  const recent = formatRecentConversation(recentMessages, 4);
  if (recent) sections.push(`Recent turns:\n${recent}`);
  return sections.join('\n\n');
}

function summarizeToolResultForPrompt(result: any, maxChars = 1600): string {
  const raw = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  const text = String(raw || '').trim();
  if (!text) return 'No tool output returned.';
  try {
    const parsed = JSON.parse(text);
    return compactPromptText(JSON.stringify(parsed), maxChars);
  } catch {
    return compactPromptText(text, maxChars);
  }
}

function summarizeToolArgsForPrompt(args: any, maxChars = 500): string {
  try {
    return compactPromptText(JSON.stringify(args || {}), maxChars);
  } catch {
    return compactPromptText(String(args || ''), maxChars);
  }
}

function describeToolForPrompt(tool: any): string {
  let requiredArgsText = '';
  try {
    const cfg = tool.config ? JSON.parse(tool.config) : {};
    if (Array.isArray(cfg?.requiredArgs) && cfg.requiredArgs.length) {
      requiredArgsText = ` args:${cfg.requiredArgs.map((x: any) => String(x)).join(',')}`;
    }
  } catch {}
  const name = String(tool?.name || 'tool');
  const description = compactPromptText(tool?.description || 'No description provided.', 110);
  return `- ${name}: ${description}${requiredArgsText}`;
}

app.use(cookieParser());
app.use(express.json());

const localRunLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// Platform (Auth + Runs/Events API)
registerPlatformRoutes(app);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'agentic-orchestrator',
    sqlitePath: getSqlitePath(),
    redisConnected: isRedisConnected(),
    now: new Date().toISOString(),
  });
});

// Platform ingest selection (used for internal orchestrator runs -> platform traces)
app.get('/api/platform/ingestion', (_req, res) => {
  const projectId = getSetting(SETTINGS_KEY_PLATFORM_INGEST_PROJECT_ID);
  res.json({ projectId });
});

app.put('/api/platform/ingestion', async (req, res) => {
  try {
    const projectId = req.body?.projectId as unknown;
    if (projectId == null || projectId === '') {
      await setSetting(SETTINGS_KEY_PLATFORM_INGEST_PROJECT_ID, null);
      return res.json({ projectId: null });
    }
    if (typeof projectId !== 'string') return res.status(400).json({ error: 'projectId must be a string' });

    const project = await getPrisma().project.findUnique({ where: { id: projectId } });
    if (!project) return res.status(400).json({ error: 'Project not found' });

    await setSetting(SETTINGS_KEY_PLATFORM_INGEST_PROJECT_ID, projectId);
    res.json({ projectId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// MCP exposure configuration
app.get('/api/mcp/config', (_req, res) => {
  const token = getSetting(SETTINGS_KEY_MCP_AUTH_TOKEN);
  res.json({ auth_token: token || null });
});

app.put('/api/mcp/config', async (req, res) => {
  const { auth_token } = req.body || {};
  if (auth_token === '' || auth_token == null) {
    await setSetting(SETTINGS_KEY_MCP_AUTH_TOKEN, null);
    return res.json({ auth_token: null });
  }
  if (typeof auth_token !== 'string') return res.status(400).json({ error: 'auth_token must be a string' });
  await setSetting(SETTINGS_KEY_MCP_AUTH_TOKEN, auth_token.trim());
  res.json({ auth_token: auth_token.trim() });
});

// MCP exposed tools
app.get('/api/mcp/exposed-tools', async (_req, res) => {
  try {
    const prisma = getPrisma();
    const [tools, exposures] = await Promise.all([
      prisma.orchestratorTool.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true, description: true, category: true, type: true },
      }),
      prisma.orchestratorMcpExposedTool.findMany({
        select: { toolId: true, exposedName: true, description: true },
      }),
    ]);
    const exposureByToolId = new Map(exposures.map((row) => [row.toolId, row]));
    res.json(tools.map((tool) => {
      const exposure = exposureByToolId.get(tool.id);
      return {
        tool_id: tool.id,
        tool_name: tool.name,
        tool_description: tool.description,
        category: tool.category,
        tool_type: tool.type,
        exposed_name: exposure?.exposedName ?? null,
        exposed_description: exposure?.description ?? null,
      };
    }));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/mcp/exposed-tools/:toolId/versions', (req, res) => {
  const toolId = Number(req.params.toolId);
  if (!Number.isFinite(toolId)) return res.status(400).json({ error: 'Invalid tool id' });
  const tool = db.prepare('SELECT id, name FROM tools WHERE id = ?').get(toolId) as any;
  if (!tool) return res.status(404).json({ error: 'Tool not found' });
  const versions = db.prepare(`
    SELECT id, tool_id, version_number, exposed_name, description, is_exposed, change_kind, created_at
    FROM mcp_exposed_tool_versions
    WHERE tool_id = ?
    ORDER BY version_number DESC, id DESC
  `).all(toolId);
  res.json({ tool, versions });
});

app.put('/api/mcp/exposed-tools/:toolId', async (req, res) => {
  const toolId = Number(req.params.toolId);
  if (!Number.isFinite(toolId)) return res.status(400).json({ error: 'Invalid tool id' });
  const { exposed, exposed_name, description } = req.body || {};
  const tool = db.prepare('SELECT id, name, description FROM tools WHERE id = ?').get(toolId) as any;
  if (!tool) return res.status(404).json({ error: 'Tool not found' });

  const currentVersion = Number((db.prepare('SELECT MAX(version_number) as max_version FROM mcp_exposed_tool_versions WHERE tool_id = ?').get(toolId) as any)?.max_version || 0);

  try {
    const prisma = getPrisma();
    if (!exposed) {
      await prisma.orchestratorMcpExposedTool.deleteMany({ where: { toolId } });
      await prisma.orchestratorAgentMcpTool.deleteMany({ where: { toolId } });
      await prisma.orchestratorMcpExposedToolVersion.create({
        data: {
          toolId,
          versionNumber: currentVersion + 1,
          exposedName: null,
          description: null,
          isExposed: false,
          changeKind: 'disable',
        },
      });
      await refreshPersistentMirror();
      return res.json({ exposed: false });
    }

    const name = typeof exposed_name === 'string' && exposed_name.trim()
      ? exposed_name.trim()
      : String(tool.name).toLowerCase().replace(/[^a-z0-9_\\-]/g, '_');
    const desc = typeof description === 'string' && description.trim()
      ? description.trim()
      : (tool.description || '');

    await prisma.orchestratorMcpExposedTool.upsert({
      where: { toolId },
      update: {
        exposedName: name,
        description: desc,
        updatedAt: new Date(),
      },
      create: {
        toolId,
        exposedName: name,
        description: desc,
      },
    });
    await prisma.orchestratorMcpExposedToolVersion.create({
      data: {
        toolId,
        versionNumber: currentVersion + 1,
        exposedName: name,
        description: desc,
        isExposed: true,
        changeKind: currentVersion === 0 ? 'create' : 'update',
      },
    });
    await refreshPersistentMirror();

    res.json({ exposed: true, exposed_name: name, description: desc });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to update exposed tool' });
  }
});

app.post('/api/mcp/exposed-tools/:toolId/restore/:versionId', async (req, res) => {
  const toolId = Number(req.params.toolId);
  const versionId = Number(req.params.versionId);
  if (!Number.isFinite(toolId) || !Number.isFinite(versionId)) return res.status(400).json({ error: 'Invalid tool or version id' });
  const version = db.prepare(`
    SELECT *
    FROM mcp_exposed_tool_versions
    WHERE id = ? AND tool_id = ?
    LIMIT 1
  `).get(versionId, toolId) as any;
  if (!version) return res.status(404).json({ error: 'Exposure version not found' });
  const currentVersion = Number((db.prepare('SELECT MAX(version_number) as max_version FROM mcp_exposed_tool_versions WHERE tool_id = ?').get(toolId) as any)?.max_version || 0);
  try {
    const prisma = getPrisma();
    if (!version.is_exposed) {
      await prisma.orchestratorMcpExposedTool.deleteMany({ where: { toolId } });
      await prisma.orchestratorAgentMcpTool.deleteMany({ where: { toolId } });
      await prisma.orchestratorMcpExposedToolVersion.create({
        data: {
          toolId,
          versionNumber: currentVersion + 1,
          exposedName: null,
          description: null,
          isExposed: false,
          changeKind: 'restore',
        },
      });
      await refreshPersistentMirror();
      return res.json({ success: true, exposed: false, version: currentVersion + 1 });
    }
    await prisma.orchestratorMcpExposedTool.upsert({
      where: { toolId },
      update: {
        exposedName: version.exposed_name,
        description: version.description || '',
        updatedAt: new Date(),
      },
      create: {
        toolId,
        exposedName: version.exposed_name,
        description: version.description || '',
      },
    });
    await prisma.orchestratorMcpExposedToolVersion.create({
      data: {
        toolId,
        versionNumber: currentVersion + 1,
        exposedName: version.exposed_name,
        description: version.description || '',
        isExposed: true,
        changeKind: 'restore',
      },
    });
    await refreshPersistentMirror();
    res.json({ success: true, exposed: true, version: currentVersion + 1 });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to restore exposed tool version' });
  }
});

// MCP bundles: expose a selected set of tools as one MCP endpoint.
app.get('/api/mcp/bundles', async (_req, res) => {
  try {
    const prisma = getPrisma();
    const [bundles, bundleTools, tools, exposures] = await Promise.all([
      prisma.orchestratorMcpBundle.findMany({ orderBy: { updatedAt: 'desc' } }),
      prisma.orchestratorMcpBundleTool.findMany({ orderBy: [{ bundleId: 'asc' }, { toolId: 'asc' }] }),
      prisma.orchestratorTool.findMany({
        select: { id: true, name: true, description: true, category: true },
      }),
      prisma.orchestratorMcpExposedTool.findMany({
        select: { toolId: true, exposedName: true },
      }),
    ]);
    const toolById = new Map(tools.map((tool) => [tool.id, tool]));
    const exposureByToolId = new Map(exposures.map((row) => [row.toolId, row.exposedName]));
    const toolsByBundle = new Map<number, any[]>();
    for (const row of bundleTools) {
      const tool = toolById.get(row.toolId);
      if (!tool) continue;
      if (!toolsByBundle.has(row.bundleId)) toolsByBundle.set(row.bundleId, []);
      toolsByBundle.get(row.bundleId)!.push({
        tool_id: tool.id,
        tool_name: tool.name,
        tool_description: tool.description,
        category: tool.category,
        exposed_name: exposureByToolId.get(tool.id) || null,
      });
    }
    res.json(bundles.map((b) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      description: b.description,
      created_at: b.createdAt,
      updated_at: b.updatedAt,
      tools: toolsByBundle.get(b.id) || [],
      tool_count: (toolsByBundle.get(b.id) || []).length,
    })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

function getMcpBundleDependencies(bundleId: number) {
  const agents = db.prepare(`
    SELECT a.id, a.name
    FROM agent_mcp_bundles amb
    JOIN agents a ON a.id = amb.agent_id
    WHERE amb.bundle_id = ?
    ORDER BY a.name ASC
  `).all(bundleId) as any[];
  return {
    agents,
    agents_count: agents.length,
  };
}

app.get('/api/mcp/bundles/:id/versions', (req, res) => {
  const bundleId = Number(req.params.id);
  if (!Number.isFinite(bundleId)) return res.status(400).json({ error: 'Invalid bundle id' });
  const bundle = db.prepare('SELECT id, name, slug FROM mcp_bundles WHERE id = ?').get(bundleId) as any;
  if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
  const versions = db.prepare(`
    SELECT id, bundle_id, version_number, name, slug, description, tool_ids, change_kind, created_at
    FROM mcp_bundle_versions
    WHERE bundle_id = ?
    ORDER BY version_number DESC, id DESC
  `).all(bundleId);
  const dependencies = getMcpBundleDependencies(bundleId);
  res.json({ bundle, versions, dependencies });
});

app.post('/api/mcp/bundles', async (req, res) => {
  const { name, slug, description, tool_ids } = req.body || {};
  const parsedIds = Array.isArray(tool_ids) ? [...new Set(tool_ids.map((v: any) => Number(v)).filter((n: number) => Number.isFinite(n)))] : [];
  if (!parsedIds.length) return res.status(400).json({ error: 'tool_ids must include at least one tool' });
  const cleanName = typeof name === 'string' && name.trim() ? name.trim() : 'MCP Bundle';
  const cleanSlug = (typeof slug === 'string' && slug.trim() ? slug.trim() : cleanName.toLowerCase())
    .replace(/[^a-z0-9_-]/gi, '_')
    .toLowerCase();
  if (!cleanSlug) return res.status(400).json({ error: 'Invalid slug' });

  try {
    const prisma = getPrisma();
    const existing = await prisma.orchestratorMcpBundle.findUnique({ where: { slug: cleanSlug } });
    let bundleId: number;
    let previousVersion = 0;
    if (existing) {
      bundleId = existing.id;
      previousVersion = Number((await prisma.orchestratorMcpBundleVersion.aggregate({
        where: { bundleId },
        _max: { versionNumber: true },
      }))._max.versionNumber || 0);
      await prisma.orchestratorMcpBundle.update({
        where: { id: bundleId },
        data: {
          name: cleanName,
          description: typeof description === 'string' ? description : null,
          updatedAt: new Date(),
        },
      });
    } else {
      const created = await prisma.orchestratorMcpBundle.create({
        data: {
          name: cleanName,
          slug: cleanSlug,
          description: typeof description === 'string' ? description : null,
        },
      });
      bundleId = created.id;
    }

    const validTools = await prisma.orchestratorTool.findMany({
      where: { id: { in: parsedIds } },
      select: { id: true },
    });
    await prisma.orchestratorMcpBundleTool.deleteMany({ where: { bundleId } });
    if (validTools.length) {
      await prisma.orchestratorMcpBundleTool.createMany({
        data: validTools.map((row) => ({ bundleId, toolId: row.id })),
        skipDuplicates: true,
      });
    }
    await prisma.orchestratorMcpBundleVersion.create({
      data: {
        bundleId,
        versionNumber: previousVersion + 1 || 1,
        name: cleanName,
        slug: cleanSlug,
        description: typeof description === 'string' ? description : null,
        toolIds: JSON.stringify(validTools.map((row) => row.id)),
        changeKind: previousVersion === 0 ? 'create' : 'update',
      },
    });
    await refreshPersistentMirror();
    res.json({ success: true, id: bundleId, slug: cleanSlug });
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Failed to save MCP bundle' });
  }
});

app.post('/api/mcp/bundles/:id/restore/:versionId', async (req, res) => {
  const bundleId = Number(req.params.id);
  const versionId = Number(req.params.versionId);
  if (!Number.isFinite(bundleId) || !Number.isFinite(versionId)) return res.status(400).json({ error: 'Invalid bundle or version id' });
  const bundle = db.prepare('SELECT id FROM mcp_bundles WHERE id = ?').get(bundleId) as any;
  if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
  const version = db.prepare(`
    SELECT *
    FROM mcp_bundle_versions
    WHERE id = ? AND bundle_id = ?
    LIMIT 1
  `).get(versionId, bundleId) as any;
  if (!version) return res.status(404).json({ error: 'Bundle version not found' });
  let toolIds: number[] = [];
  try {
    const parsed = JSON.parse(version.tool_ids || '[]');
    toolIds = Array.isArray(parsed) ? parsed.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x)) : [];
  } catch {}
  const currentVersion = Number((db.prepare('SELECT MAX(version_number) as max_version FROM mcp_bundle_versions WHERE bundle_id = ?').get(bundleId) as any)?.max_version || 0);
  try {
    const prisma = getPrisma();
    const validTools = await prisma.orchestratorTool.findMany({
      where: { id: { in: toolIds } },
      select: { id: true },
    });
    await prisma.orchestratorMcpBundle.update({
      where: { id: bundleId },
      data: {
        name: version.name,
        slug: version.slug,
        description: version.description || null,
        updatedAt: new Date(),
      },
    });
    await prisma.orchestratorMcpBundleTool.deleteMany({ where: { bundleId } });
    if (validTools.length) {
      await prisma.orchestratorMcpBundleTool.createMany({
        data: validTools.map((row) => ({ bundleId, toolId: row.id })),
        skipDuplicates: true,
      });
    }
    await prisma.orchestratorMcpBundleVersion.create({
      data: {
        bundleId,
        versionNumber: currentVersion + 1,
        name: version.name,
        slug: version.slug,
        description: version.description || null,
        toolIds: JSON.stringify(validTools.map((row) => row.id)),
        changeKind: 'restore',
      },
    });
    await refreshPersistentMirror();
    res.json({ success: true, version: currentVersion + 1 });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to restore bundle version' });
  }
});

app.delete('/api/mcp/bundles/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid bundle id' });
  const force = String(req.query.force || '') === 'true';
  const dependencies = getMcpBundleDependencies(id);
  if (dependencies.agents_count > 0 && !force) {
    return res.status(409).json({ error: 'Bundle is still linked to agents.', dependencies });
  }
  try {
    const prisma = getPrisma();
    await prisma.orchestratorAgentMcpBundle.deleteMany({ where: { bundleId: id } });
    await prisma.orchestratorMcpBundleTool.deleteMany({ where: { bundleId: id } });
    await prisma.orchestratorMcpBundleVersion.deleteMany({ where: { bundleId: id } });
    await prisma.orchestratorMcpBundle.delete({ where: { id } });
    await refreshPersistentMirror();
    res.json({ success: true, forced: force });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to delete MCP bundle' });
  }
});

// Per-project platform linkage (local project -> platform project)
app.get('/api/projects/:id/platform-link', async (req, res) => {
  try {
    const localProjectId = Number(req.params.id);
    if (!Number.isFinite(localProjectId)) return res.status(400).json({ error: 'Invalid project id' });
    const row = await getPrisma().orchestratorProjectLink.findUnique({
      where: { projectId: localProjectId },
      select: { platformProjectId: true },
    });
    res.json({ platformProjectId: row?.platformProjectId ?? null });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/projects/:id/platform-link', async (req, res) => {
  try {
    const prisma = getPrisma();
    const localProjectId = Number(req.params.id);
    if (!Number.isFinite(localProjectId)) return res.status(400).json({ error: 'Invalid project id' });

    let localProject = await prisma.orchestratorProject.findUnique({ where: { id: localProjectId }, select: { id: true } });
    if (!localProject) {
      const localProjectName = req.body?.localProjectName as unknown;
      if (typeof localProjectName === 'string' && localProjectName.trim()) {
        localProject = await prisma.orchestratorProject.findFirst({
          where: { name: localProjectName.trim() },
          orderBy: { id: 'desc' },
          select: { id: true },
        });
      }
    }
    if (!localProject) return res.status(404).json({ error: 'Project not found' });

    const platformProjectId = req.body?.platformProjectId as unknown;
    if (platformProjectId == null || platformProjectId === '') {
      await prisma.orchestratorProjectLink.deleteMany({ where: { projectId: localProject.id } });
      await refreshPersistentMirror();
      return res.json({ platformProjectId: null });
    }
    if (typeof platformProjectId !== 'string') return res.status(400).json({ error: 'platformProjectId must be a string' });

    const project = await getPrisma().project.findUnique({ where: { id: platformProjectId } });
    if (!project) return res.status(400).json({ error: 'Platform project not found' });

    await prisma.orchestratorProjectLink.upsert({
      where: { projectId: localProject.id },
      update: { platformProjectId, updatedAt: new Date() },
      create: { projectId: localProject.id, platformProjectId },
    });
    await refreshPersistentMirror();

    res.json({ platformProjectId });
  } catch (e: any) {
    console.error('Failed to update project link:', e);
    res.status(500).json({ error: e.message });
  }
});

// API Routes

// --- Credentials ---
app.get('/api/credentials', async (req, res) => {
  try {
    const category = String(req.query.category || '').trim();
    const credentials = await getPrisma().orchestratorCredential.findMany({
      where: category ? { category } : undefined,
      orderBy: { id: 'asc' },
    });
    res.json(credentials.map((row) => ({
      id: row.id,
      provider: row.provider,
      name: row.name || row.provider,
      key_name: row.keyName || 'Authorization',
      category: row.category || 'general',
      api_key: '********',
    })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/credentials', async (req, res) => {
  const { provider, name, key_name, category, api_key, key_value } = req.body || {};
  const credentialKey = String(provider || '').trim();
  const secretValue = String(api_key || key_value || '').trim();
  const categoryValue = String(category || 'general').trim() || 'general';
  if (!credentialKey) return res.status(400).json({ error: 'provider (credential key) is required' });
  if (!secretValue) return res.status(400).json({ error: 'api_key (credential value) is required' });
  try {
    await getPrisma().orchestratorCredential.upsert({
      where: { provider: credentialKey },
      update: {
        name: String(name || credentialKey).trim(),
        keyName: String(key_name || 'Authorization').trim(),
        category: categoryValue,
        apiKey: secretValue,
        updatedAt: new Date(),
      },
      create: {
        provider: credentialKey,
        name: String(name || credentialKey).trim(),
        keyName: String(key_name || 'Authorization').trim(),
        category: categoryValue,
        apiKey: secretValue,
      },
    });
    await refreshPersistentMirror();
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/credentials/:id', async (req, res) => {
  try {
    await getPrisma().orchestratorCredential.delete({ where: { id: Number(req.params.id) } });
    await refreshPersistentMirror();
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- LLM Providers ---
app.get('/api/providers', async (req, res) => {
  try {
    const providers = await getPrisma().orchestratorLlmProvider.findMany({
      orderBy: { id: 'asc' },
    });
    res.json(providers.map((row) => ({
      id: row.id,
      name: row.name,
      provider: row.provider,
      api_base: row.apiBase,
      api_key: '********',
      is_default: row.isDefault,
    })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/providers', async (req, res) => {
  const { name, provider, api_base, api_key, is_default } = req.body;
  const prisma = getPrisma();
  try {
    if (is_default) {
      await prisma.orchestratorLlmProvider.updateMany({
        where: { provider },
        data: { isDefault: false, updatedAt: new Date() },
      });
    }
    const created = await prisma.orchestratorLlmProvider.create({
      data: {
        name,
        provider,
        apiBase: api_base || null,
        apiKey: api_key || null,
        isDefault: Boolean(is_default),
      },
    });
    await refreshPersistentMirror();
    res.json({ id: created.id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/providers/:id', async (req, res) => {
  const { name, provider, api_base, api_key, is_default } = req.body;
  const prisma = getPrisma();
  try {
    if (is_default) {
      await prisma.orchestratorLlmProvider.updateMany({
        where: { provider, id: { not: Number(req.params.id) } },
        data: { isDefault: false, updatedAt: new Date() },
      });
    }
    const existing = await prisma.orchestratorLlmProvider.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Provider not found' });
    await prisma.orchestratorLlmProvider.update({
      where: { id: Number(req.params.id) },
      data: {
        name,
        provider,
        apiBase: api_base || null,
        apiKey: api_key && api_key !== '********' ? api_key : existing.apiKey,
        isDefault: Boolean(is_default),
        updatedAt: new Date(),
      },
    });
    await refreshPersistentMirror();
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/providers/:id', async (req, res) => {
  try {
    await getPrisma().orchestratorLlmProvider.delete({ where: { id: Number(req.params.id) } });
    await refreshPersistentMirror();
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Model Pricing ---
app.get('/api/pricing', (_req, res) => {
  const rows = db.prepare('SELECT * FROM model_pricing ORDER BY model ASC').all();
  res.json(rows);
});

app.post('/api/pricing', (req, res) => {
  const { model, input_usd, output_usd } = req.body || {};
  if (!model || typeof model !== 'string') return res.status(400).json({ error: 'model is required' });
  const input = normalizeNumber(input_usd);
  const output = normalizeNumber(output_usd);
  if (input == null || output == null) return res.status(400).json({ error: 'input_usd and output_usd must be numbers' });
  try {
    const info = db.prepare('INSERT INTO model_pricing (model, input_usd, output_usd) VALUES (?, ?, ?)').run(model, input, output);
    res.json({ id: info.lastInsertRowid });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/pricing/:id', (req, res) => {
  const { model, input_usd, output_usd } = req.body || {};
  const input = normalizeNumber(input_usd);
  const output = normalizeNumber(output_usd);
  if (!model || typeof model !== 'string') return res.status(400).json({ error: 'model is required' });
  if (input == null || output == null) return res.status(400).json({ error: 'input_usd and output_usd must be numbers' });
  db.prepare('UPDATE model_pricing SET model = ?, input_usd = ?, output_usd = ? WHERE id = ?')
    .run(model, input, output, req.params.id);
  res.json({ success: true });
});

app.delete('/api/pricing/:id', (req, res) => {
  db.prepare('DELETE FROM model_pricing WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/providers/:id/models', async (req, res) => {
  try {
    const config = await getProviderConfig(req.params.id);
    if (!config.apiKey) {
      return res.status(400).json({ error: 'API Key not found' });
    }

    let models: { id: string, name: string }[] = [];

    if (config.providerType === 'openai' || config.providerType === 'openai-compatible') {
      const openai = new OpenAI({ apiKey: config.apiKey, baseURL: config.apiBase });
      const response = await openai.models.list();
      models = response.data.map(m => ({ id: m.id, name: m.id }));
    } else if (config.providerType === 'anthropic') { // Original condition, assuming config.type is not available here
      try {
        const anthropic = new Anthropic({ apiKey: config.apiKey });
        const response = await anthropic.models.list();
        models = response.data.map(m => ({ id: m.id, name: m.display_name || m.id }));
      } catch (e) {
        // Fallback if list endpoint fails - use valid models
        models = [
          { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
          { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
          { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
          { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' }
        ];
      }
    } else {
      // Google Gen AI
      try {
        const ai = new GoogleGenAI({ apiKey: config.apiKey });
        const response = await ai.models.list();
        for await (const m of response) {
          models.push({ id: m.name.replace('models/', ''), name: m.displayName || m.name.replace('models/', '') });
        }
      } catch (e: any) {
        // Fallback - use valid, existing models
        console.warn(`Model fetch failed for ${req.params.id}:`, e.message);
        models = [
          { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
          { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
          { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash (Exp)' },
          { id: 'gemini-1.0-pro', name: 'Gemini 1.0 Pro' }
        ];
      }
    }

    res.json(models);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

async function validateMCPConfig(config: any) {
    const { serverUrl, apiKey, credentialId, transportType, customHeaders } = config || {};
    if (!serverUrl) throw new Error('serverUrl is required for MCP tools.');
    if (transportType && transportType !== 'sse' && transportType !== 'streamable' && transportType !== 'auto') {
        throw new Error('transportType must be "sse", "streamable", or "auto".');
    }
    const parsedCredentialId = Number(credentialId);
    const credentialKey = Number.isFinite(parsedCredentialId)
      ? (db.prepare('SELECT api_key FROM credentials WHERE id = ?').get(parsedCredentialId) as any)?.api_key
      : undefined;
    const effectiveApiKey = apiKey || credentialKey;

    const url = new URL(serverUrl);
    const transportOpts: any = {};
    let headers: Record<string, string> = {};
    if (customHeaders && typeof customHeaders === 'object') {
        headers = { ...(customHeaders as Record<string, string>) };
    } else if (typeof customHeaders === 'string' && customHeaders.trim()) {
        try { headers = JSON.parse(customHeaders); } catch { /* ignore */ }
    }
    if (effectiveApiKey) {
        if (!headers.Authorization && !(headers as any).authorization) headers.Authorization = `Bearer ${effectiveApiKey}`;
        if (!headers['X-API-Key'] && !(headers as any)['x-api-key']) headers['X-API-Key'] = effectiveApiKey;
    }
    if (Object.keys(headers).length) {
        transportOpts.eventSourceInit = { headers };
        transportOpts.requestInit = { headers };
    }

    const transportTypeResolved = transportType || 'auto';
    const hasMcpPath = serverUrl.endsWith('/mcp') || serverUrl.includes('/mcp?');
    const hasSsePath = serverUrl.endsWith('/sse') || serverUrl.includes('/sse?');
    const candidates = transportTypeResolved === 'auto'
      ? (hasMcpPath ? ['streamable'] : (hasSsePath ? ['sse'] : ['streamable', 'sse']))
      : [transportTypeResolved];

    let lastErr: any = null;
    for (const candidate of candidates) {
        const transport = candidate === 'streamable'
          ? new StreamableHTTPClientTransport(url, { requestInit: transportOpts.requestInit })
          : new SSEClientTransport(url, transportOpts);
        const client = new Client(
            { name: 'voice-orchestrator', version: '0.3.0' },
            { capabilities: {} }
        );
        const timeout = new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('MCP initialization timed out after 8s')), 8000)
        );
        try {
            await Promise.race([client.connect(transport), timeout]);
            const mcpTools = await withTimeout(client.listTools(), 8000, 'MCP listTools');
            return { tools: mcpTools.tools, transportType: candidate };
        } catch (e: any) {
            lastErr = e;
        } finally {
            try { await client.close(); } catch (e) {}
        }
    }
    if (hasMcpPath && transportTypeResolved === 'auto') {
        throw new Error((lastErr?.message || 'MCP connection failed') + ' (Auto-detect tried Streamable HTTP for /mcp)');
    }
    throw lastErr || new Error('MCP connection failed');
}

// --- Tools ---
app.get('/api/tools', async (req, res) => {
  try {
    const prisma = getPrisma();
    const [tools, agentTools, agents, exposures, bundleTools, bundles] = await Promise.all([
      prisma.orchestratorTool.findMany({ orderBy: { name: 'asc' } }),
      prisma.orchestratorAgentTool.findMany({ orderBy: [{ toolId: 'asc' }, { agentId: 'asc' }] }),
      prisma.orchestratorAgent.findMany({ select: { id: true, name: true } }),
      prisma.orchestratorMcpExposedTool.findMany(),
      prisma.orchestratorMcpBundleTool.findMany({ orderBy: [{ toolId: 'asc' }, { bundleId: 'asc' }] }),
      prisma.orchestratorMcpBundle.findMany({ select: { id: true, name: true, slug: true } }),
    ]);
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const exposureByToolId = new Map(exposures.map((row) => [row.toolId, row]));
    const bundleById = new Map(bundles.map((bundle) => [bundle.id, bundle]));
    const agentLinksByToolId = new Map<number, Array<{ id: number; name: string }>>();
    for (const row of agentTools) {
      const agent = agentById.get(row.agentId);
      if (!agent) continue;
      if (!agentLinksByToolId.has(row.toolId)) agentLinksByToolId.set(row.toolId, []);
      agentLinksByToolId.get(row.toolId)!.push({ id: agent.id, name: agent.name });
    }
    const bundlesByToolId = new Map<number, Array<{ id: number; name: string; slug: string }>>();
    for (const row of bundleTools) {
      const bundle = bundleById.get(row.bundleId);
      if (!bundle) continue;
      if (!bundlesByToolId.has(row.toolId)) bundlesByToolId.set(row.toolId, []);
      bundlesByToolId.get(row.toolId)!.push({ id: bundle.id, name: bundle.name, slug: bundle.slug });
    }
    res.json(tools.map((tool) => {
      const linkedAgents = agentLinksByToolId.get(tool.id) || [];
      const exposed = exposureByToolId.get(tool.id);
      const linkedBundles = bundlesByToolId.get(tool.id) || [];
      return {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        category: tool.category,
        type: tool.type,
        config: tool.config,
        version: tool.version,
        updated_at: tool.updatedAt,
        created_at: tool.createdAt,
        linkages: {
          agents: linkedAgents,
          agents_count: linkedAgents.length,
          mcp_exposed: exposed ? {
            exposed_name: exposed.exposedName,
            description: exposed.description,
            updated_at: exposed.updatedAt,
          } : null,
          bundles: linkedBundles,
          bundles_count: linkedBundles.length,
        },
      };
    }));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

function getToolDependencies(toolId: number) {
  const linkedAgents = db.prepare(`
    SELECT a.id, a.name
    FROM agent_tools at
    JOIN agents a ON a.id = at.agent_id
    WHERE at.tool_id = ?
    ORDER BY a.name ASC
  `).all(toolId) as any[];
  const exposed = db.prepare(`
    SELECT exposed_name, description, updated_at
    FROM mcp_exposed_tools
    WHERE tool_id = ?
    LIMIT 1
  `).get(toolId) as any;
  const bundles = db.prepare(`
    SELECT b.id, b.name, b.slug
    FROM mcp_bundle_tools bt
    JOIN mcp_bundles b ON b.id = bt.bundle_id
    WHERE bt.tool_id = ?
    ORDER BY b.name ASC
  `).all(toolId) as any[];
  const mcpAgents = db.prepare(`
    SELECT a.id, a.name
    FROM agent_mcp_tools amt
    JOIN agents a ON a.id = amt.agent_id
    WHERE amt.tool_id = ?
    ORDER BY a.name ASC
  `).all(toolId) as any[];
  return {
    agents: linkedAgents,
    agents_count: linkedAgents.length,
    mcp_exposed: exposed ? {
      exposed_name: exposed.exposed_name,
      description: exposed.description,
      updated_at: exposed.updated_at,
    } : null,
    bundles,
    bundles_count: bundles.length,
    mcp_agents: mcpAgents,
    mcp_agents_count: mcpAgents.length,
  };
}

async function getToolUsageStats(toolId: number) {
  const prisma = getPrisma();
  const summary = await prisma.orchestratorToolExecution.aggregate({
    where: { toolId },
    _count: { _all: true },
    _avg: { durationMs: true },
    _max: { createdAt: true }
  });

  const statusCounts = await prisma.orchestratorToolExecution.groupBy({
    by: ['status'],
    where: { toolId },
    _count: { _all: true }
  });

  const failedRuns = statusCounts.find(s => s.status === 'failed')?._count._all || 0;
  const completedRuns = statusCounts.find(s => s.status === 'completed')?._count._all || 0;

  const recentExecutions = await prisma.orchestratorToolExecution.findMany({
    where: { toolId },
    include: {
      agent: { select: { id: true, name: true } }
    },
    orderBy: { id: 'desc' },
    take: 20
  });

  return {
    total_runs: summary._count._all || 0,
    failed_runs: failedRuns,
    completed_runs: completedRuns,
    avg_duration_ms: summary._avg.durationMs != null ? Math.round(summary._avg.durationMs) : null,
    last_used_at: summary._max.createdAt ? summary._max.createdAt.toISOString() : null,
    recent_executions: recentExecutions.map(te => ({
      ...te,
      tool_id: te.toolId,
      agent_id: te.agentId,
      agent_execution_id: te.agentExecutionId,
      tool_name: te.toolName,
      tool_type: te.toolType,
      duration_ms: te.durationMs,
      created_at: te.createdAt.toISOString(),
      agent_name: te.agent?.name
    })),
  };
}

app.get('/api/tools/:id/dependencies', async (req, res) => {
  const toolId = Number(req.params.id);
  if (!Number.isFinite(toolId)) return res.status(400).json({ error: 'Invalid tool id' });
  try {
    const prisma = getPrisma();
    const tool = await prisma.orchestratorTool.findUnique({
      where: { id: toolId },
      select: { id: true, name: true, version: true, updatedAt: true },
    });
    if (!tool) return res.status(404).json({ error: 'Tool not found' });
    const dependencies = getToolDependencies(toolId);
    const versionCount = await prisma.orchestratorToolVersion.count({ where: { toolId } });
    const usage = await getToolUsageStats(toolId);
    res.json({
      tool: {
        id: tool.id,
        name: tool.name,
        version: tool.version,
        updated_at: tool.updatedAt,
      },
      dependencies,
      version_count: versionCount,
      usage,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/tools/:id/versions', async (req, res) => {
  const toolId = Number(req.params.id);
  if (!Number.isFinite(toolId)) return res.status(400).json({ error: 'Invalid tool id' });
  try {
    const prisma = getPrisma();
    const tool = await prisma.orchestratorTool.findUnique({
      where: { id: toolId },
      select: { id: true, name: true },
    });
    if (!tool) return res.status(404).json({ error: 'Tool not found' });
    const versions = await prisma.orchestratorToolVersion.findMany({
      where: { toolId },
      orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }],
    });
    res.json({
      tool,
      versions: versions.map((row) => ({
        id: row.id,
        tool_id: row.toolId,
        version_number: row.versionNumber,
        name: row.name,
        description: row.description,
        category: row.category,
        type: row.type,
        config: row.config,
        change_kind: row.changeKind,
        created_at: row.createdAt,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tools/:id/restore/:versionId', async (req, res) => {
  try {
    const prisma = getPrisma();
    const toolId = Number(req.params.id);
    const versionId = Number(req.params.versionId);
    if (!Number.isFinite(toolId) || !Number.isFinite(versionId)) {
      return res.status(400).json({ error: 'Invalid tool or version id' });
    }
    const tool = db.prepare('SELECT * FROM tools WHERE id = ?').get(toolId) as any;
    if (!tool) return res.status(404).json({ error: 'Tool not found' });
    const version = db.prepare(`
      SELECT *
      FROM tool_versions
      WHERE id = ? AND tool_id = ?
      LIMIT 1
    `).get(versionId, toolId) as any;
    if (!version) return res.status(404).json({ error: 'Tool version not found' });

    let parsedConfig: any = {};
    try {
      parsedConfig = version.config ? JSON.parse(version.config) : {};
    } catch {
      parsedConfig = {};
    }
    if (version.type === 'mcp') {
      const validation = await validateMCPConfig(parsedConfig);
      if (validation?.transportType && (!parsedConfig?.transportType || parsedConfig.transportType === 'auto')) {
        parsedConfig.transportType = validation.transportType;
      }
    }

    const now = new Date().toISOString();
    const nextVersion = Number(tool.version || 1) + 1;
    const serializedConfig = JSON.stringify(parsedConfig || {});
    await prisma.orchestratorTool.update({
      where: { id: toolId },
      data: {
        name: version.name,
        description: version.description,
        category: version.category || 'General',
        type: version.type || 'custom',
        config: serializedConfig,
        version: nextVersion,
        updatedAt: new Date(now),
      },
    });
    await prisma.orchestratorToolVersion.create({
      data: {
        toolId,
        versionNumber: nextVersion,
        name: version.name,
        description: version.description,
        category: version.category || 'General',
        type: version.type || 'custom',
        config: serializedConfig,
        changeKind: 'restore',
        createdAt: new Date(now),
      },
    });
    await refreshPersistentMirror();

    res.json({ success: true, restored_from_version_id: versionId, version: nextVersion });
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Failed to restore tool version.' });
  }
});

app.get('/api/tools/:id/usage', async (req, res) => {
  const toolId = Number(req.params.id);
  if (!Number.isFinite(toolId)) return res.status(400).json({ error: 'Invalid tool id' });
  const tool = db.prepare('SELECT id, name FROM tools WHERE id = ?').get(toolId) as any;
  if (!tool) return res.status(404).json({ error: 'Tool not found' });
  const usage = await getToolUsageStats(toolId);
  res.json({ tool, usage });
});

function inferToolCategory(name: any, description: any, type: any, config: any, requestedCategory: any) {
  const explicit = String(requestedCategory || '').trim();
  if (explicit && !['general', 'mcp'].includes(explicit.toLowerCase())) return explicit;

  const haystack = [
    String(name || ''),
    String(description || ''),
    typeof config?.serverUrl === 'string' ? config.serverUrl : '',
    typeof config?.command === 'string' ? config.command : '',
    typeof config?.mcpToolName === 'string' ? config.mcpToolName : '',
  ].join(' ').toLowerCase();

  if (/(facebook|meta|instagram|ads pixel|lookalike|custom audience)/.test(haystack)) return 'FB';
  if (/(google|youtube|gads|adwords)/.test(haystack)) return 'Google';
  if (/(shopify)/.test(haystack)) return 'Shopify';
  if (/(slack)/.test(haystack)) return 'Slack';
  if (/(notion)/.test(haystack)) return 'Notion';
  if (/(airtable)/.test(haystack)) return 'Airtable';
  if (/(hubspot)/.test(haystack)) return 'HubSpot';
  if (/(stripe)/.test(haystack)) return 'Stripe';
  if (/(postgres|mysql|sqlite|database|sql)/.test(haystack)) return 'Database';
  if (String(type || '').trim().toLowerCase() === 'mcp') return explicit || 'MCP';
  return explicit || 'General';
}

app.post('/api/tools', async (req, res) => {
  try {
    const prisma = getPrisma();
    const { name, description, category, type, config, skip_validate } = req.body;
    if (type === 'mcp') {
      if (!skip_validate) {
        const validation = await validateMCPConfig(config);
        if (validation?.transportType && (!config?.transportType || config.transportType === 'auto')) {
          config.transportType = validation.transportType;
        }
      }
    }
    const now = new Date().toISOString();
    const serializedConfig = config ? JSON.stringify(config) : '{}';
    const resolvedCategory = inferToolCategory(name, description, type, config, category);
    const created = await prisma.orchestratorTool.create({
      data: {
        name,
        description,
        category: resolvedCategory,
        type: type || 'custom',
        config: serializedConfig,
        version: 1,
        updatedAt: new Date(now),
      },
    });
    await prisma.orchestratorToolVersion.create({
      data: {
        toolId: created.id,
        versionNumber: 1,
        name,
        description,
        category: resolvedCategory,
        type: type || 'custom',
        config: serializedConfig,
        changeKind: 'create',
        createdAt: new Date(now),
      },
    });
    await refreshPersistentMirror();
    res.json({ id: created.id });
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Failed to save tool.' });
  }
});

app.put('/api/tools/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    const { id } = req.params;
    const { name, description, category, type, config, skip_validate } = req.body;
    if (type === 'mcp') {
      if (!skip_validate) {
        const validation = await validateMCPConfig(config);
        if (validation?.transportType && (!config?.transportType || config.transportType === 'auto')) {
          config.transportType = validation.transportType;
        }
      }
    }
    const existing = db.prepare('SELECT * FROM tools WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Tool not found' });
    const nextVersion = Number(existing.version || 1) + 1;
    const now = new Date().toISOString();
    const serializedConfig = config ? JSON.stringify(config) : '{}';
    const resolvedCategory = inferToolCategory(name, description, type, config, category);
    await prisma.orchestratorTool.update({
      where: { id: Number(id) },
      data: {
        name,
        description,
        category: resolvedCategory,
        type: type || 'custom',
        config: serializedConfig,
        version: nextVersion,
        updatedAt: new Date(now),
      },
    });
    await prisma.orchestratorToolVersion.create({
      data: {
        toolId: Number(id),
        versionNumber: nextVersion,
        name,
        description,
        category: resolvedCategory,
        type: type || 'custom',
        config: serializedConfig,
        changeKind: 'update',
        createdAt: new Date(now),
      },
    });
    await refreshPersistentMirror();
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Failed to update tool.' });
  }
});

app.post('/api/tools/http-test', async (req, res) => {
  try {
    const { config, args } = req.body || {};
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'config is required.' });
    }
    const result = await runHttpTool(config, args ?? {});
    res.json({ result });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'HTTP test failed.' });
  }
});

app.post('/api/tools/mcp-test', async (req, res) => {
  try {
    const { serverUrl, apiKey, credentialId, transportType, customHeaders } = req.body || {};
    const result = await validateMCPConfig({ serverUrl, apiKey, credentialId, transportType, customHeaders });
    res.json({ 
      success: true, 
      transportType: result.transportType,
      toolCount: result.tools.length, 
      tools: result.tools.map((t: any) => t.name) 
    });
  } catch (e: any) {
    const message = e?.message || 'Connection failed';
    res.status(400).json({ error: message });
  }
});

app.delete('/api/tools/:id', async (req, res) => {
  console.log(`Deleting tool ${req.params.id}`);
  try {
    const force = String(req.query.force || '') === 'true';
    const idNum = Number(req.params.id);
    if (!Number.isFinite(idNum)) return res.status(400).json({ error: 'Invalid tool id' });
    const tool = db.prepare('SELECT id, name FROM tools WHERE id = ?').get(idNum) as any;
    if (!tool) return res.status(404).json({ error: 'Tool not found' });
    const dependencies = getToolDependencies(idNum);
    const hasDependencies = Boolean(
      dependencies.agents_count ||
      dependencies.mcp_agents_count
    );
    if (hasDependencies && !force) {
      return res.status(409).json({
        error: 'Tool is still linked to active resources.',
        dependencies,
      });
    }
    const prisma = getPrisma();
    await prisma.orchestratorAgentTool.deleteMany({ where: { toolId: idNum } });
    await prisma.orchestratorAgentMcpTool.deleteMany({ where: { toolId: idNum } });
    await prisma.orchestratorMcpBundleTool.deleteMany({ where: { toolId: idNum } });
    await prisma.orchestratorMcpExposedToolVersion.deleteMany({ where: { toolId: idNum } });
    await prisma.orchestratorMcpExposedTool.deleteMany({ where: { toolId: idNum } });
    await prisma.orchestratorToolVersion.deleteMany({ where: { toolId: idNum } });
    await prisma.orchestratorTool.delete({ where: { id: idNum } });
    await refreshPersistentMirror();
    db.prepare('DELETE FROM tool_executions WHERE tool_id = ?').run(idNum);
    console.log(`Tool ${req.params.id} deleted successfully`);
    res.json({ success: true, forced: force, deleted_tool_id: idNum });
  } catch (e: any) {
    console.error("Error deleting tool:", e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tools/autobuild', async (req, res) => {
  const { goal, agent_ids, provider = 'google', model = 'gemini-1.5-flash' } = req.body || {};

  if (!goal || typeof goal !== 'string') {
    return res.status(400).json({ error: 'Goal is required.' });
  }

  try {
    const config = await getProviderConfig(provider);
    const apiKey = config.apiKey;
    if (!apiKey) {
      return res.status(500).json({ error: `API Key not configured for provider: ${provider}` });
    }

    const availableAgents = Array.isArray(agent_ids) && agent_ids.length
      ? db.prepare('SELECT id, name, role, goal, backstory, model, provider FROM agents WHERE id IN (' + agent_ids.map(() => '?').join(',') + ')').all(...agent_ids)
      : db.prepare('SELECT id, name, role, goal, backstory, model, provider FROM agents').all();

    const availableTools = db.prepare('SELECT id, name, description, type, config FROM tools').all();

    const prompt = `
    You are an expert Tool Builder for AI agents.
    Your goal is to design the right tools so the agents can accomplish the user's objective.

    User Objective: "${goal}"

    Available Agents (use these IDs for assignment):
    ${JSON.stringify(availableAgents)}

    Existing Tool Library (reuse if appropriate):
    ${JSON.stringify(availableTools)}

    Instructions:
    1. Propose tools that best enable the agents to accomplish the objective.
    2. Reuse existing tools if they already fit (by referencing existing_tool_id).
    3. Each tool can be assigned to multiple agents via assign_to_agent_ids.
    4. Tool types supported: python, http, mcp, search, calculator, custom.
    5. For python tools, config should include { "code": "python code" } and the code should read from a variable named args (dict).
    6. For http tools, config should include { "method": "GET|POST|PUT|DELETE", "url": "...", "headers": {...}, "body": "string or JSON" }.
    7. For mcp tools, config should include { "serverUrl": "...", "apiKey": "optional" }.

    Response Format (JSON only):
    {
      "tools": [
        {
          "name": "Tool Name",
          "description": "What it does",
          "category": "Short family or platform label like FB, Google, Research, CRM, Database",
          "type": "python|http|mcp|search|calculator|custom",
          "config": { },
          "assign_to_agent_ids": [1,2],
          "existing_tool_id": 123
        }
      ]
    }
    `;

    let text = '';
    if (config.providerType === 'google') {
      const ai = new GoogleGenAI({ apiKey });
      const response = await withRetry(() => ai.models.generateContent({
        model: model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      }));
      text = response.text;
    } else if (config.providerType === 'openai' || config.providerType === 'openai-compatible') {
      const openai = new OpenAI({ apiKey, baseURL: config.apiBase });
      const response = await withRetry(() => openai.chat.completions.create({
        model: model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: "json_object" }
      }));
      text = response.choices[0].message.content || '';
    } else if (config.providerType === 'anthropic') {
      const anthropic = new Anthropic({ apiKey, baseURL: config.apiBase });
      const response = await withRetry(() => anthropic.messages.create({
        model: model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      }));
      if (response.content[0].type === 'text') text = response.content[0].text;
    } else {
      throw new Error(`Provider ${config.providerType} not supported for tool auto-build.`);
    }

    let design: any;
    try {
      design = JSON.parse(text);
    } catch {
      const jsonString = text.replace(/```json\n?|\n?```/g, "").trim();
      design = JSON.parse(jsonString);
    }

    if (!design.tools || !Array.isArray(design.tools)) {
      throw new Error("Invalid design: 'tools' array is missing");
    }

    const supportedTypes = new Set(['python', 'http', 'mcp', 'search', 'calculator', 'custom']);
    const availableAgentIdSet = new Set((availableAgents as any[]).map((a: any) => Number(a.id)));
    const normalizeToolType = (toolDef: any) => {
      const raw = String(toolDef?.type || '').trim().toLowerCase();
      if (['python', 'code', 'coding', 'script', 'python_script'].includes(raw)) return 'python';
      if (['http', 'http_request', 'api', 'rest', 'rest_api', 'webhook'].includes(raw)) return 'http';
      if (supportedTypes.has(raw)) return raw;
      if (toolDef?.config?.code) return 'python';
      if (toolDef?.config?.url || toolDef?.config?.endpoint) return 'http';
      return 'custom';
    };
    const normalizeToolConfig = (toolDef: any, normalizedType: string) => {
      const cfg = (toolDef && typeof toolDef.config === 'object' && toolDef.config !== null) ? { ...toolDef.config } : {};
      if (normalizedType === 'python') {
        const code = typeof cfg.code === 'string' && cfg.code.trim()
          ? cfg.code
          : 'result = args if isinstance(args, dict) else {"input": args}\nprint(result)';
        return { code };
      }
      if (normalizedType === 'http') {
        const method = String(cfg.method || toolDef?.method || 'GET').toUpperCase();
        const url = String(cfg.url || cfg.endpoint || toolDef?.url || '');
        return {
          method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(method) ? method : 'GET',
          url,
          headers: (cfg.headers && typeof cfg.headers === 'object') ? cfg.headers : {},
          body: cfg.body ?? '',
        };
      }
      return cfg;
    };

    const prisma = getPrisma();
    const createdToolIds: number[] = [];
    const existingToolById = new Set((availableTools as any[]).map((t: any) => Number(t.id)));

    for (const toolDef of design.tools) {
      const normalizedType = normalizeToolType(toolDef);
      const normalizedConfig = normalizeToolConfig(toolDef, normalizedType);
      const normalizedName = String(toolDef?.name || '').trim() || `Auto ${normalizedType} tool`;
      const normalizedDescription = String(toolDef?.description || '').trim() || `Auto-generated ${normalizedType} tool for: ${goal}`;
      const normalizedCategory = inferToolCategory(
        normalizedName,
        normalizedDescription,
        normalizedType,
        normalizedConfig,
        toolDef?.category
      );

      let toolId = Number(toolDef?.existing_tool_id);
      if (!Number.isFinite(toolId) || !existingToolById.has(toolId)) {
        toolId = 0;
      }

      if (!toolId) {
        const created = await prisma.orchestratorTool.create({
          data: {
            name: normalizedName,
            description: normalizedDescription,
            category: normalizedCategory,
            type: normalizedType || 'custom',
            config: JSON.stringify(normalizedConfig || {}),
            version: 1,
          },
        });
        await prisma.orchestratorToolVersion.create({
          data: {
            toolId: created.id,
            versionNumber: 1,
            name: normalizedName,
            description: normalizedDescription,
            category: normalizedCategory,
            type: normalizedType || 'custom',
            config: JSON.stringify(normalizedConfig || {}),
            changeKind: 'create',
          },
        });
        toolId = created.id;
        createdToolIds.push(toolId);
      }

      const assignIds = Array.isArray(toolDef?.assign_to_agent_ids) && toolDef.assign_to_agent_ids.length
        ? toolDef.assign_to_agent_ids
            .map((id: any) => Number(id))
            .filter((id: number) => Number.isFinite(id) && availableAgentIdSet.has(id))
        : [];

      if (assignIds.length) {
        await prisma.orchestratorAgentTool.createMany({
          data: assignIds.map((agentId: number) => ({ agentId, toolId })),
          skipDuplicates: true,
        });
      }
    }

    await refreshPersistentMirror();
    const newToolIds = createdToolIds;
    res.json({ tool_ids: newToolIds, design });
  } catch (e: any) {
    console.error("Tool auto-build failed:", e);
    res.status(500).json({ error: "Failed to auto-build tools: " + e.message });
  }
});

// --- Agents ---
app.get('/api/agents', async (req, res) => {
  try {
    const prisma = getPrisma();
    const [agents, agentTools, tools, agentMcpTools, agentMcpBundles, bundles, exposures] = await Promise.all([
      prisma.orchestratorAgent.findMany({ orderBy: { id: 'asc' } }),
      prisma.orchestratorAgentTool.findMany({ orderBy: [{ agentId: 'asc' }, { toolId: 'asc' }] }),
      prisma.orchestratorTool.findMany({ orderBy: { name: 'asc' } }),
      prisma.orchestratorAgentMcpTool.findMany({ orderBy: [{ agentId: 'asc' }, { toolId: 'asc' }] }),
      prisma.orchestratorAgentMcpBundle.findMany({ orderBy: [{ agentId: 'asc' }, { bundleId: 'asc' }] }),
      prisma.orchestratorMcpBundle.findMany({ orderBy: { name: 'asc' } }),
      prisma.orchestratorMcpExposedTool.findMany(),
    ]);
    const toolById = new Map(tools.map((tool) => [tool.id, tool]));
    const exposureByToolId = new Map(exposures.map((row) => [row.toolId, row]));
    const bundleById = new Map(bundles.map((bundle) => [bundle.id, bundle]));
    const agentToolsMap = new Map<number, any[]>();
    for (const row of agentTools) {
      const tool = toolById.get(row.toolId);
      if (!tool) continue;
      if (!agentToolsMap.has(row.agentId)) agentToolsMap.set(row.agentId, []);
      agentToolsMap.get(row.agentId)!.push({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        category: tool.category,
        type: tool.type,
        config: tool.config,
        version: tool.version,
        updated_at: tool.updatedAt,
        created_at: tool.createdAt,
      });
    }
    const agentMcpToolsMap = new Map<number, any[]>();
    for (const row of agentMcpTools) {
      const tool = toolById.get(row.toolId);
      const exposure = exposureByToolId.get(row.toolId);
      if (!tool || !exposure) continue;
      if (!agentMcpToolsMap.has(row.agentId)) agentMcpToolsMap.set(row.agentId, []);
      agentMcpToolsMap.get(row.agentId)!.push({
        tool_id: tool.id,
        tool_name: tool.name,
        exposed_name: exposure.exposedName,
        description: exposure.description,
      });
    }
    const agentMcpBundlesMap = new Map<number, any[]>();
    for (const row of agentMcpBundles) {
      const bundle = bundleById.get(row.bundleId);
      if (!bundle) continue;
      if (!agentMcpBundlesMap.has(row.agentId)) agentMcpBundlesMap.set(row.agentId, []);
      agentMcpBundlesMap.get(row.agentId)!.push({
        id: bundle.id,
        name: bundle.name,
        slug: bundle.slug,
        description: bundle.description,
      });
    }

    const agentsWithDetails = await Promise.all(agents.map(async (agent) => {
      const stats = db.prepare(`
          SELECT 
              SUM(prompt_tokens) as prompt_tokens, 
              SUM(completion_tokens) as completion_tokens, 
              SUM(total_cost) as total_cost 
          FROM agent_executions 
          WHERE agent_id = ?
      `).get(agent.id) as any;
      const runningExecutions = db.prepare("SELECT COUNT(*) as count FROM agent_executions WHERE agent_id = ? AND status = 'running'").get(agent.id) as any;
      const queuedJobs = db.prepare(`
        SELECT COUNT(*) as count
        FROM job_queue
        WHERE type = 'run_agent'
          AND status = 'pending'
          AND CAST(json_extract(payload, '$.agentId') AS INTEGER) = ?
      `).get(agent.id) as any;
      const config = await getProviderConfig(agent.provider);
      const mcpTools = agentMcpToolsMap.get(agent.id) || [];
      const mcpBundles = agentMcpBundlesMap.get(agent.id) || [];
      return {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        agent_role: agent.agentRole,
        status: agent.status,
        goal: agent.goal,
        backstory: agent.backstory,
        system_prompt: agent.systemPrompt,
        model: agent.model,
        provider: agent.provider,
        temperature: agent.temperature,
        max_tokens: agent.maxTokens,
        memory_window: agent.memoryWindow,
        max_iterations: agent.maxIterations,
        tools_enabled: agent.toolsEnabled,
        retry_policy: agent.retryPolicy,
        timeout_ms: agent.timeoutMs,
        is_exposed: agent.isExposed,
        project_id: agent.projectId,
        created_at: agent.createdAt,
        updated_at: agent.updatedAt,
        tools: agentToolsMap.get(agent.id) || [],
        stats: {
          prompt_tokens: stats.prompt_tokens || 0,
          completion_tokens: stats.completion_tokens || 0,
          total_cost: stats.total_cost || 0,
        },
        running_count: (runningExecutions.count || 0) + (queuedJobs.count || 0),
        credential_source: config.source,
        credential_source_name: config.sourceName,
        mcp_tool_ids: mcpTools.map((x: any) => Number(x.tool_id)),
        mcp_bundle_ids: mcpBundles.map((x: any) => Number(x.id)),
        mcp_tools: mcpTools,
        mcp_bundles: mcpBundles,
      };
    }));
    res.json(agentsWithDetails);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/agents', async (req, res) => {
  const {
    name,
    role,
    agent_role,
    goal,
    backstory,
    system_prompt,
    model,
    provider,
    temperature,
    max_tokens,
    memory_window,
    max_iterations,
    tools_enabled,
    retry_policy,
    timeout_ms,
    mcp_tool_ids,
    mcp_bundle_ids,
    toolIds,
    is_exposed,
    project_id,
  } = req.body;
  const normalizedName = String(name || '').trim();
  const normalizedRole = String(role || '').trim();
  const normalizedGoal = String(goal || '').trim() || `Act as ${normalizedRole || 'AI Specialist'} and complete assigned tasks with clear, reliable outputs.`;
  const normalizedBackstory = String(backstory || '').trim() || 'A focused AI specialist created for consistent, production-grade task execution.';
  if (!normalizedName) return res.status(400).json({ error: 'name is required' });
  if (!normalizedRole) return res.status(400).json({ error: 'role is required' });
  const finalSystemPrompt = system_prompt && String(system_prompt).trim()
    ? String(system_prompt).trim()
    : buildSystemPrompt({ name: normalizedName, role: normalizedRole, goal: normalizedGoal, backstory: normalizedBackstory });
  try {
    const prisma = getPrisma();
    const created = await prisma.orchestratorAgent.create({
      data: {
        name: normalizedName,
        role: normalizedRole,
        agentRole: agent_role || '',
        goal: normalizedGoal,
        backstory: normalizedBackstory,
        systemPrompt: finalSystemPrompt,
        model: String(model || 'gemini-1.5-flash'),
        provider: String(provider || 'google'),
        temperature: normalizeNumber(temperature),
        maxTokens: normalizeNumber(max_tokens),
        memoryWindow: normalizeNumber(memory_window),
        maxIterations: normalizeNumber(max_iterations),
        toolsEnabled: tools_enabled !== false,
        retryPolicy: retry_policy || null,
        timeoutMs: normalizeNumber(timeout_ms),
        isExposed: Boolean(is_exposed),
        projectId: project_id || null,
      },
    });

    if (toolIds && Array.isArray(toolIds)) {
      const data = toolIds.map((toolId: any) => ({
        agentId: created.id,
        toolId: Number(toolId),
      })).filter((row: any) => Number.isFinite(row.toolId));
      if (data.length) await prisma.orchestratorAgentTool.createMany({ data, skipDuplicates: true });
    }
    if (Array.isArray(mcp_tool_ids)) {
      const validToolIds = mcp_tool_ids.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x));
      const exposed = await prisma.orchestratorMcpExposedTool.findMany({
        where: { toolId: { in: validToolIds } },
        select: { toolId: true },
      });
      const data = exposed.map((row) => ({ agentId: created.id, toolId: row.toolId }));
      if (data.length) await prisma.orchestratorAgentMcpTool.createMany({ data, skipDuplicates: true });
    }
    if (Array.isArray(mcp_bundle_ids)) {
      const validBundleIds = mcp_bundle_ids.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x));
      const bundles = await prisma.orchestratorMcpBundle.findMany({
        where: { id: { in: validBundleIds } },
        select: { id: true },
      });
      const data = bundles.map((row) => ({ agentId: created.id, bundleId: row.id }));
      if (data.length) await prisma.orchestratorAgentMcpBundle.createMany({ data, skipDuplicates: true });
    }
    await refreshPersistentMirror();
    res.json({ id: created.id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/agents/:id', async (req, res) => {
  const {
    name,
    role,
    agent_role,
    goal,
    backstory,
    system_prompt,
    model,
    provider,
    temperature,
    max_tokens,
    memory_window,
    max_iterations,
    tools_enabled,
    retry_policy,
    timeout_ms,
    mcp_tool_ids,
    mcp_bundle_ids,
    toolIds,
    is_exposed,
    project_id,
  } = req.body;
  const normalizedName = String(name || '').trim();
  const normalizedRole = String(role || '').trim();
  const normalizedGoal = String(goal || '').trim() || `Act as ${normalizedRole || 'AI Specialist'} and complete assigned tasks with clear, reliable outputs.`;
  const normalizedBackstory = String(backstory || '').trim() || 'A focused AI specialist created for consistent, production-grade task execution.';
  if (!normalizedName) return res.status(400).json({ error: 'name is required' });
  if (!normalizedRole) return res.status(400).json({ error: 'role is required' });
  const finalSystemPrompt = system_prompt && String(system_prompt).trim()
    ? String(system_prompt).trim()
    : buildSystemPrompt({ name: normalizedName, role: normalizedRole, goal: normalizedGoal, backstory: normalizedBackstory });
  try {
    const prisma = getPrisma();
    const agentId = Number(req.params.id);
    await prisma.orchestratorAgent.update({
      where: { id: agentId },
      data: {
        name: normalizedName,
        role: normalizedRole,
        agentRole: agent_role || '',
        goal: normalizedGoal,
        backstory: normalizedBackstory,
        systemPrompt: finalSystemPrompt,
        model: String(model || 'gemini-1.5-flash'),
        provider: provider || 'google',
        temperature: normalizeNumber(temperature),
        maxTokens: normalizeNumber(max_tokens),
        memoryWindow: normalizeNumber(memory_window),
        maxIterations: normalizeNumber(max_iterations),
        toolsEnabled: tools_enabled !== false,
        retryPolicy: retry_policy || null,
        timeoutMs: normalizeNumber(timeout_ms),
        isExposed: Boolean(is_exposed),
        projectId: project_id || null,
        updatedAt: new Date(),
      },
    });

    await prisma.orchestratorAgentTool.deleteMany({ where: { agentId } });
    if (toolIds && Array.isArray(toolIds)) {
      const data = toolIds.map((toolId: any) => ({ agentId, toolId: Number(toolId) })).filter((row: any) => Number.isFinite(row.toolId));
      if (data.length) await prisma.orchestratorAgentTool.createMany({ data, skipDuplicates: true });
    }

    await prisma.orchestratorAgentMcpTool.deleteMany({ where: { agentId } });
    if (Array.isArray(mcp_tool_ids)) {
      const validToolIds = mcp_tool_ids.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x));
      const exposed = await prisma.orchestratorMcpExposedTool.findMany({
        where: { toolId: { in: validToolIds } },
        select: { toolId: true },
      });
      const data = exposed.map((row) => ({ agentId, toolId: row.toolId }));
      if (data.length) await prisma.orchestratorAgentMcpTool.createMany({ data, skipDuplicates: true });
    }

    await prisma.orchestratorAgentMcpBundle.deleteMany({ where: { agentId } });
    if (Array.isArray(mcp_bundle_ids)) {
      const validBundleIds = mcp_bundle_ids.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x));
      const bundles = await prisma.orchestratorMcpBundle.findMany({
        where: { id: { in: validBundleIds } },
        select: { id: true },
      });
      const data = bundles.map((row) => ({ agentId, bundleId: row.id }));
      if (data.length) await prisma.orchestratorAgentMcpBundle.createMany({ data, skipDuplicates: true });
    }

    await refreshPersistentMirror();
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/agents/:id', async (req, res) => {
  console.log(`Deleting agent ${req.params.id}`);
  try {
    const agentId = Number(req.params.id);
    const prisma = getPrisma();
    await prisma.orchestratorAgentTool.deleteMany({ where: { agentId } });
    await prisma.orchestratorAgentMcpTool.deleteMany({ where: { agentId } });
    await prisma.orchestratorAgentMcpBundle.deleteMany({ where: { agentId } });
    await prisma.orchestratorCrewAgent.deleteMany({ where: { agentId } });
    await prisma.orchestratorCrew.updateMany({
      where: { coordinatorAgentId: agentId },
      data: { coordinatorAgentId: null, updatedAt: new Date() },
    });
    await prisma.orchestratorTask.deleteMany({ where: { agentId } });
    await prisma.orchestratorAgent.delete({ where: { id: agentId } });
    await prisma.orchestratorAgentExecution.deleteMany({ where: { agentId } });
    await prisma.orchestratorToolExecution.deleteMany({ where: { agentId } });
    await prisma.orchestratorAgentSession.deleteMany({ where: { agentId } });
    await refreshPersistentMirror();
    // Mirror to SQLite
    try {
      db.prepare('DELETE FROM agent_executions WHERE agent_id = ?').run(agentId);
      db.prepare('DELETE FROM tool_executions WHERE agent_id = ?').run(agentId);
      db.prepare('DELETE FROM agent_sessions WHERE agent_id = ?').run(agentId);
    } catch {}
    console.log(`Agent ${agentId} deleted successfully`);
    res.json({ success: true });
  } catch (e: any) {
    console.error("Error deleting agent:", e);
    res.status(500).json({ error: e.message });
  }
});

// --- Projects ---
app.get('/api/projects', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const prisma = getPrisma();
    const [projects, crews, agents] = await Promise.all([
      prisma.orchestratorProject.findMany({ orderBy: { id: 'asc' } }),
      prisma.orchestratorCrew.findMany({ select: { id: true, projectId: true } }),
      prisma.orchestratorAgent.findMany({ select: { id: true, projectId: true } }),
    ]);

    const crewIdsByProject = new Map<number, number[]>();
    for (const crew of crews) {
      if (crew.projectId == null) continue;
      if (!crewIdsByProject.has(crew.projectId)) crewIdsByProject.set(crew.projectId, []);
      crewIdsByProject.get(crew.projectId)!.push(crew.id);
    }

    const agentIdsByProject = new Map<number, number[]>();
    for (const agent of agents) {
      if (agent.projectId == null) continue;
      if (!agentIdsByProject.has(agent.projectId)) agentIdsByProject.set(agent.projectId, []);
      agentIdsByProject.get(agent.projectId)!.push(agent.id);
    }

    const projectsWithStats = projects.map((p) => {
      const crewIds = crewIdsByProject.get(p.id) || [];
      const agentIds = agentIdsByProject.get(p.id) || [];
      let crewCost = 0;
      if (crewIds.length > 0) {
        const placeholders = crewIds.map(() => '?').join(',');
        const result = db.prepare(`SELECT SUM(total_cost) as cost FROM crew_executions WHERE crew_id IN (${placeholders})`).get(...crewIds) as any;
        crewCost = result.cost || 0;
      }
      let agentCost = 0;
      if (agentIds.length > 0) {
        const placeholders = agentIds.map(() => '?').join(',');
        const result = db.prepare(`SELECT SUM(total_cost) as cost FROM agent_executions WHERE agent_id IN (${placeholders})`).get(...agentIds) as any;
        agentCost = result.cost || 0;
      }
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        created_at: p.createdAt,
        crews_count: crewIds.length,
        agents_count: agentIds.length,
        total_cost: crewCost + agentCost,
      };
    });
    res.json(projectsWithStats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/platform-links', async (req, res) => {
  try {
    const links = await getPrisma().orchestratorProjectLink.findMany({
      select: { projectId: true, platformProjectId: true },
    });
    const map: Record<number, string> = {};
    for (const row of links) {
      map[row.projectId] = row.platformProjectId;
    }
    res.json({ links: map });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects', async (req, res) => {
  const { name, description } = req.body;
  try {
    const created = await getPrisma().orchestratorProject.create({
      data: { name, description: description || null },
    });
    await refreshPersistentMirror();
    res.json({ id: created.id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:id', async (req, res) => {
  try {
    const project = await getPrisma().orchestratorProject.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json({
      id: project.id,
      name: project.name,
      description: project.description,
      created_at: project.createdAt,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:id/traces', async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    if (!Number.isFinite(projectId)) return res.status(400).json({ error: 'Invalid project id' });

    const executions = await getPrisma().orchestratorAgentExecution.findMany({
      where: {
        agent: {
          projectId: projectId
        }
      },
      include: {
        agent: {
          select: { name: true, role: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(executions.map(ae => ({
      ...ae,
      agent_id: ae.agentId,
      agent_name: ae.agent?.name,
      agent_role: ae.agent?.role,
      created_at: ae.createdAt.toISOString(),
      execution_kind: ae.executionKind,
      parent_execution_id: ae.parentExecutionId,
      delegation_title: ae.delegationTitle,
      prompt_tokens: ae.promptTokens,
      completion_tokens: ae.completionTokens,
      total_cost: ae.totalCost,
      retry_of: ae.retryOf
    })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:id/tool-traces', async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    if (!Number.isFinite(projectId)) return res.status(400).json({ error: 'Invalid project id' });

    const rows = await getPrisma().orchestratorToolExecution.findMany({
      where: {
        agent: {
          projectId: projectId
        }
      },
      include: {
        agent: {
          select: { name: true, role: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(rows.map(te => ({
      ...te,
      tool_id: te.toolId,
      agent_id: te.agentId,
      agent_execution_id: te.agentExecutionId,
      tool_name: te.toolName,
      tool_type: te.toolType,
      duration_ms: te.durationMs,
      agent_name: te.agent?.name,
      agent_role: te.agent?.role,
      created_at: te.createdAt.toISOString()
    })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Workflows ---
app.get('/api/workflows', async (req, res) => {
  try {
    const prisma = getPrisma();
    const projectId = Number(req.query.project_id);
    const [workflows, workflowRuns] = await Promise.all([
      prisma.orchestratorWorkflow.findMany({
        where: Number.isFinite(projectId) ? { projectId } : undefined,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        include: {
          project: { select: { name: true } },
        },
      }),
      prisma.orchestratorWorkflowRun.findMany({
        select: { workflowId: true, status: true, createdAt: true, id: true },
        orderBy: [{ workflowId: 'asc' }, { id: 'desc' }],
      }),
    ]);
    const runsByWorkflow = new Map<number, Array<{ status: string; createdAt: Date }>>();
    for (const run of workflowRuns) {
      const list = runsByWorkflow.get(run.workflowId) || [];
      list.push({ status: run.status, createdAt: run.createdAt });
      runsByWorkflow.set(run.workflowId, list);
    }
    const result = workflows.map((workflow) => {
      const runs = runsByWorkflow.get(workflow.id) || [];
      const lastRun = runs[0];
      return {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        status: workflow.status,
        trigger_type: workflow.triggerType,
        graph: workflow.graph,
        version: workflow.version,
        updated_at: workflow.updatedAt,
        project_id: workflow.projectId,
        created_at: workflow.createdAt,
        project_name: workflow.project?.name || null,
        runs_count: runs.length,
        last_run_status: lastRun?.status || null,
        last_run_at: lastRun?.createdAt || null,
      };
    });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/workflows/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid workflow id' });
  try {
    const [workflow, runs] = await Promise.all([
      getPrisma().orchestratorWorkflow.findUnique({ where: { id } }),
      getPrisma().orchestratorWorkflowRun.findMany({ where: { workflowId: id }, orderBy: { id: 'desc' }, take: 20 }),
    ]);
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
    res.json({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      status: workflow.status,
      trigger_type: workflow.triggerType,
      graph: workflow.graph,
      version: workflow.version,
      updated_at: workflow.updatedAt,
      project_id: workflow.projectId,
      created_at: workflow.createdAt,
      runs,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/workflows', async (req, res) => {
  try {
    const prisma = getPrisma();
    const { name, description, status, trigger_type, graph, project_id } = req.body || {};
    const normalizedGraph = normalizeWorkflowGraph(parseWorkflowGraph(graph || { nodes: [], edges: [] }));
    const serializedGraph = JSON.stringify(normalizedGraph);
    const now = new Date().toISOString();
    const workflowName = String(name || 'Untitled Workflow').trim() || 'Untitled Workflow';
    const workflow = await prisma.orchestratorWorkflow.create({
      data: {
        name: workflowName,
        description: typeof description === 'string' ? description : null,
        status: String(status || 'draft'),
        triggerType: String(trigger_type || 'manual'),
        graph: serializedGraph,
        version: 1,
        updatedAt: new Date(now),
        projectId: Number.isFinite(Number(project_id)) ? Number(project_id) : null,
      },
    });
    await prisma.orchestratorWorkflowVersion.create({
      data: {
        workflowId: workflow.id,
        versionNumber: 1,
        name: workflowName,
        description: typeof description === 'string' ? description : null,
        status: String(status || 'draft'),
        triggerType: String(trigger_type || 'manual'),
        graph: serializedGraph,
        changeKind: 'create',
        createdAt: new Date(now),
      },
    });
    await refreshPersistentMirror();
    res.json({ id: workflow.id });
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Failed to create workflow' });
  }
});

app.put('/api/workflows/:id', async (req, res) => {
  try {
    const prisma = getPrisma();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid workflow id' });
    const existing = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Workflow not found' });
    const { name, description, status, trigger_type, graph, project_id } = req.body || {};
    const normalizedGraph = normalizeWorkflowGraph(parseWorkflowGraph(graph || existing.graph || { nodes: [], edges: [] }));
    const serializedGraph = JSON.stringify(normalizedGraph);
    const nextVersion = Number(existing.version || 1) + 1;
    const now = new Date().toISOString();
    const workflowName = String(name || existing.name || 'Untitled Workflow').trim() || 'Untitled Workflow';
    await prisma.orchestratorWorkflow.update({
      where: { id },
      data: {
        name: workflowName,
        description: typeof description === 'string' ? description : existing.description,
        status: String(status || existing.status || 'draft'),
        triggerType: String(trigger_type || existing.trigger_type || 'manual'),
        graph: serializedGraph,
        version: nextVersion,
        updatedAt: new Date(now),
        projectId: Number.isFinite(Number(project_id)) ? Number(project_id) : existing.project_id ?? null,
      },
    });
    await prisma.orchestratorWorkflowVersion.create({
      data: {
        workflowId: id,
        versionNumber: nextVersion,
        name: workflowName,
        description: typeof description === 'string' ? description : existing.description,
        status: String(status || existing.status || 'draft'),
        triggerType: String(trigger_type || existing.trigger_type || 'manual'),
        graph: serializedGraph,
        changeKind: 'update',
        createdAt: new Date(now),
      },
    });
    await refreshPersistentMirror();
    res.json({ success: true, version: nextVersion });
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Failed to update workflow' });
  }
});

app.delete('/api/workflows/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid workflow id' });
  try {
    const prisma = getPrisma();
    await prisma.orchestratorWorkflowVersion.deleteMany({ where: { workflowId: id } });
    await prisma.orchestratorWorkflow.delete({ where: { id } });
    await refreshPersistentMirror();
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/workflows/:id/versions', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid workflow id' });
  try {
    const versions = await getPrisma().orchestratorWorkflowVersion.findMany({
      where: { workflowId: id },
      orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }],
    });
    res.json({
      versions: versions.map((row) => ({
        id: row.id,
        workflow_id: row.workflowId,
        version_number: row.versionNumber,
        name: row.name,
        description: row.description,
        status: row.status,
        trigger_type: row.triggerType,
        graph: row.graph,
        change_kind: row.changeKind,
        created_at: row.createdAt,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/workflows/:id/restore/:versionId', async (req, res) => {
  const id = Number(req.params.id);
  const versionId = Number(req.params.versionId);
  if (!Number.isFinite(id) || !Number.isFinite(versionId)) return res.status(400).json({ error: 'Invalid workflow restore request' });
  try {
    const prisma = getPrisma();
    const existing = await prisma.orchestratorWorkflow.findUnique({ where: { id } });
    const version = await prisma.orchestratorWorkflowVersion.findFirst({ where: { id: versionId, workflowId: id } });
    if (!existing || !version) return res.status(404).json({ error: 'Workflow version not found' });
    const nextVersion = Number(existing.version || 1) + 1;
    const now = new Date().toISOString();
    await prisma.orchestratorWorkflow.update({
      where: { id },
      data: {
        name: version.name,
        description: version.description,
        status: version.status,
        triggerType: version.triggerType,
        graph: version.graph,
        version: nextVersion,
        updatedAt: new Date(now),
      },
    });
    await prisma.orchestratorWorkflowVersion.create({
      data: {
        workflowId: id,
        versionNumber: nextVersion,
        name: version.name,
        description: version.description,
        status: version.status,
        triggerType: version.triggerType,
        graph: version.graph,
        changeKind: 'restore',
        createdAt: new Date(now),
      },
    });
    await refreshPersistentMirror();
    res.json({ success: true, version: nextVersion });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to restore workflow version' });
  }
});

app.get('/api/workflows/:id/runs', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid workflow id' });
  getPrisma().orchestratorWorkflowRun.findMany({ where: { workflowId: id }, orderBy: { id: 'desc' } })
    .then((runs) => res.json({ runs }))
    .catch((e: any) => res.status(500).json({ error: e.message }));
});

app.get('/api/workflow-runs/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid workflow run id' });
  const run = await getPrisma().orchestratorWorkflowRun.findUnique({
    where: { id },
    include: { workflow: { select: { name: true } } },
  });
  if (!run) return res.status(404).json({ error: 'Workflow run not found' });
  res.json({
    id: run.id,
    workflow_id: run.workflowId,
    workflow_name: run.workflow?.name || null,
    status: run.status,
    trigger_type: run.triggerType,
    input: safeJsonParse(run.input, {}),
    output: safeJsonParse(run.output, null),
    logs: safeJsonParse(run.logs, []),
    graph_snapshot: safeJsonParse(run.graphSnapshot, { nodes: [], edges: [] }),
    retry_of: run.retryOf,
    updated_at: run.updatedAt,
  });
});

app.get('/api/workflow-runs/:id/stream', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid workflow run id' });
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const sendSnapshot = async () => {
    const run = await getPrisma().orchestratorWorkflowRun.findUnique({ where: { id } });
    if (!run) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Workflow run not found' })}\n\n`);
      clearInterval(timer);
      res.end();
      return;
    }
    res.write(`event: update\ndata: ${JSON.stringify({
      run: {
        id: run.id,
        workflow_id: run.workflowId,
        status: run.status,
        trigger_type: run.triggerType,
        input: safeJsonParse(run.input, {}),
        output: safeJsonParse(run.output, null),
        logs: safeJsonParse(run.logs, []),
        graph_snapshot: safeJsonParse(run.graphSnapshot, { nodes: [], edges: [] }),
        retry_of: run.retryOf,
        updated_at: run.updatedAt,
      },
    })}\n\n`);
    if (run.status !== 'running' && run.status !== 'pending') {
      res.write(`event: done\ndata: ${JSON.stringify({ status: run.status, run_id: id })}\n\n`);
      clearInterval(timer);
      res.end();
    }
  };

  const timer = setInterval(() => { void sendSnapshot(); }, 1200);
  await sendSnapshot();
  req.on('close', () => clearInterval(timer));
});

app.post('/api/workflows/:id/execute', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid workflow id' });
    const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as any;
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
    const input = req.body?.input ?? {};
    const triggerType = String(req.body?.trigger_type || workflow.trigger_type || 'manual');
    const runId = await createWorkflowRun(id, triggerType, input, workflow.graph);
    const shouldWait = req.query.wait === 'true' || req.body?.wait === true;
    if (!shouldWait) {
      const jobId = await enqueueJob('run_workflow', { workflowId: id, runId });
      return res.status(202).json({ run_id: runId, job_id: jobId, status: 'pending' });
    }
    await persistWorkflowRun(runId, 'running', null, []);
    const result = await runWorkflowExecution(runId);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to execute workflow' });
  }
});

app.post('/api/workflows/:id/webhook', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid workflow id' });
    const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as any;
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
    const configuredTrigger = String(workflow.trigger_type || 'manual').toLowerCase();
    if (configuredTrigger !== 'webhook') {
      return res.status(409).json({ error: 'Workflow is not configured for webhook triggers' });
    }
    const input = {
      body: req.body ?? {},
      query: req.query ?? {},
      headers: req.headers ?? {},
      method: req.method,
      path: req.path,
      items: Array.isArray(req.body?.items) ? req.body.items : undefined,
      message: typeof req.body?.message === 'string' ? req.body.message : undefined,
    };
    const runId = await createWorkflowRun(id, 'webhook', input, workflow.graph);
    const shouldWait = req.query.wait === 'true' || req.body?.wait === true;
    if (!shouldWait) {
      const jobId = await enqueueJob('run_workflow', { workflowId: id, runId });
      return res.status(202).json({ run_id: runId, job_id: jobId, status: 'pending' });
    }
    await persistWorkflowRun(runId, 'running', null, []);
    const result = await runWorkflowExecution(runId);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to execute workflow webhook' });
  }
});

app.delete('/api/projects/:id', async (req, res) => {
    console.log(`Deleting project ${req.params.id}`);
    try {
        const projectId = Number(req.params.id);
        const prisma = getPrisma();
        await prisma.orchestratorCrew.updateMany({
          where: { projectId },
          data: { projectId: null, updatedAt: new Date() },
        });
        await prisma.orchestratorAgent.updateMany({
          where: { projectId },
          data: { projectId: null, updatedAt: new Date() },
        });
        await prisma.orchestratorWorkflow.updateMany({
          where: { projectId },
          data: { projectId: null },
        });
        await prisma.orchestratorProjectLink.deleteMany({ where: { projectId } });
        await prisma.orchestratorProject.delete({ where: { id: projectId } });
        await refreshPersistentMirror();
        console.log(`Project ${projectId} deleted successfully`);
        res.json({ success: true });
    } catch (e: any) {
        console.error("Error deleting project:", e);
        res.status(500).json({ error: e.message });
    }
});

// --- Stats ---
app.get('/api/stats', async (req, res) => {
    try {
        const prisma = getPrisma();
        const [totalAgents, totalCrews, crewStats] = await Promise.all([
            prisma.orchestratorAgent.count(),
            prisma.orchestratorCrew.count(),
            prisma.orchestratorCrewExecution.aggregate({
                _count: { _all: true },
                _sum: { totalCost: true, promptTokens: true, completionTokens: true }
            })
        ]);

        const activeAgentExecs = await prisma.orchestratorAgentExecution.groupBy({
            by: ['agentId'],
            where: { status: 'running' },
            _count: { _all: true }
        });

        res.json({
            agents: totalAgents,
            crews: totalCrews,
            executions: crewStats._count._all || 0,
            total_cost: crewStats._sum.totalCost || 0,
            total_tokens: (crewStats._sum.promptTokens || 0) + (crewStats._sum.completionTokens || 0),
            active_agents: activeAgentExecs.length
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/analytics/failures', async (req, res) => {
  try {
    const prisma = getPrisma();
    const topFailingTools = await prisma.orchestratorToolExecution.groupBy({
      by: ['toolName'],
      where: { status: 'failed' },
      _count: { _all: true },
      orderBy: { _count: { toolName: 'desc' } },
      take: 8
    });

    const timeoutHotspotsRaw = await prisma.orchestratorAgentExecution.findMany({
      where: {
        status: 'failed',
        OR: [
          { output: { contains: 'timeout', mode: 'insensitive' } },
          { input: { contains: 'timeout', mode: 'insensitive' } }
        ]
      },
      include: {
        agent: { select: { name: true } }
      }
    });

    const hotspotsMap = new Map<string, number>();
    for (const row of timeoutHotspotsRaw) {
      if (row.agent?.name) {
        hotspotsMap.set(row.agent.name, (hotspotsMap.get(row.agent.name) || 0) + 1);
      }
    }

    const timeoutHotspots = Array.from(hotspotsMap.entries())
      .map(([agent_name, timeout_failures]) => ({ agent_name, timeout_failures }))
      .sort((a, b) => b.timeout_failures - a.timeout_failures)
      .slice(0, 8);

    const tokenSpikesRaw = await prisma.orchestratorAgentExecution.findMany({
      include: {
        agent: { select: { name: true } }
      },
      orderBy: { promptTokens: 'desc' },
      take: 24 // Take more then sort by combined
    });

    const tokenSpikes = tokenSpikesRaw.map(ae => ({
      id: ae.id,
      agent_name: ae.agent?.name,
      prompt_tokens: ae.promptTokens,
      completion_tokens: ae.completionTokens,
      total_tokens: (ae.promptTokens || 0) + (ae.completionTokens || 0),
      total_cost: ae.totalCost,
      created_at: ae.createdAt.toISOString()
    })).sort((a, b) => b.total_tokens - a.total_tokens).slice(0, 12);

    res.json({
      topFailingTools: topFailingTools.map(t => ({ tool_name: t.toolName, failures: t._count._all })),
      timeoutHotspots,
      tokenSpikes
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Direct Agent Execution (Exposed) ---
app.get('/api/agents/:id/executions', async (req, res) => {
    try {
        const agentId = Number(req.params.id);
        const executions = await getPrisma().orchestratorAgentExecution.findMany({
            where: { agentId },
            orderBy: { createdAt: 'desc' }
        });
        res.json(executions.map(ae => ({
            ...ae,
            agent_id: ae.agentId,
            created_at: ae.createdAt.toISOString(),
            execution_kind: ae.executionKind,
            parent_execution_id: ae.parentExecutionId,
            delegation_title: ae.delegationTitle,
            prompt_tokens: ae.promptTokens,
            completion_tokens: ae.completionTokens,
            total_cost: ae.totalCost,
            retry_of: ae.retryOf
        })));
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/agents/:id/sessions', async (req, res) => {
    const agentId = Number(req.params.id);
    const prisma = getPrisma();
    const sessions = await prisma.orchestratorAgentSession.findMany({
      where: { agentId },
      include: {
        memory: {
          where: { key: 'conversation' },
          take: 1
        }
      },
      orderBy: [
        { lastSeenAt: 'desc' },
        { updatedAt: 'desc' }
      ],
      take: 200
    });

    const mapped = sessions.map((s) => {
      let conversation: any[] = [];
      try {
        conversation = s.memory[0]?.value ? JSON.parse(s.memory[0].value) : [];
      } catch {
        conversation = [];
      }
      const messages = Array.isArray(conversation) ? conversation : [];
      const lastMessage = messages.length ? messages[messages.length - 1] : null;
      
      return {
        id: s.id,
        user_id: s.userId,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
        last_seen_at: s.lastSeenAt,
        message_count: messages.length,
        preview: lastMessage?.content ? String(lastMessage.content).slice(0, 160) : '',
        conversation: s.memory[0]?.value || null
      };
    });
    res.json(mapped);
});

app.get('/api/agents/:id/sessions/:sessionId/messages', async (req, res) => {
    const agentId = Number(req.params.id);
    const sessionId = String(req.params.sessionId || '');
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const prisma = getPrisma();
    const row = await prisma.orchestratorAgentSession.findFirst({
      where: { id: sessionId, agentId }
    });
    if (!row) return res.status(404).json({ error: 'Session not found for this agent' });

    const messages = await loadSessionConversation(String(sessionId));
    res.json({ session_id: sessionId, messages });
});

app.get('/api/executions/agents', async (req, res) => {
    try {
        const prisma = getPrisma();
        const executions = await prisma.orchestratorAgentExecution.findMany({
            include: {
                agent: {
                    select: { name: true }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 10
        });

        // Map to expected format
        const formatted = executions.map(e => ({
            ...e,
            created_at: (e as any).createdAt, // Map back for frontend compatibility if needed
            agent_name: (e as any).agent?.name || 'Unknown Agent'
        }));

        res.json(formatted);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/agents/:id/run', localRunLimiter, async (req, res) => {
    const agentId = req.params.id;
    const { task, session_id, user_id } = req.body;
    
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    try {
        const jobId = await enqueueJob('run_agent', {
          agentId: agent.id,
          task,
          session_id,
          user_id,
          initiatedBy: 'direct_agent_api',
        });

        const result = await waitForJob(jobId, 120000);
        res.json(result);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/agents/:id/delegate', localRunLimiter, async (req, res) => {
    const supervisorAgentId = Number(req.params.id);
    if (!Number.isFinite(supervisorAgentId)) return res.status(400).json({ error: 'Invalid agent id' });

    const {
      task,
      session_id,
      user_id,
      delegates,
      delegate_agent_ids,
      synthesis_agent_id,
      synthesize,
      wait,
      waitMs,
      pollMs,
    } = req.body || {};

    const rootTask = typeof task === 'string' ? task.trim() : '';
    if (!rootTask) return res.status(400).json({ error: 'task is required' });

    const supervisorAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(supervisorAgentId) as any;
    if (!supervisorAgent) return res.status(404).json({ error: 'Supervisor agent not found' });

    const preparedDelegates = Array.isArray(delegates) && delegates.length
      ? delegates.map((delegate: any) => ({
          agentId: Number(delegate?.agent_id ?? delegate?.agentId),
          task: typeof delegate?.task === 'string' ? delegate.task.trim() : '',
          title: typeof delegate?.title === 'string' ? delegate.title.trim() : '',
        }))
      : (Array.isArray(delegate_agent_ids) ? delegate_agent_ids : []).map((id: any) => ({
          agentId: Number(id),
          task: rootTask,
          title: '',
        }));

    if (!preparedDelegates.length) {
      return res.status(400).json({ error: 'Provide delegates or delegate_agent_ids' });
    }
    if (preparedDelegates.some((delegate) => !Number.isFinite(delegate.agentId) || delegate.agentId <= 0)) {
      return res.status(400).json({ error: 'Each delegate must include a valid agent id' });
    }

    const { parentExecutionId, workflow } = await startDelegatedExecution({
      supervisorAgent,
      task: rootTask,
      delegates: preparedDelegates,
      synthesisAgentId: Number.isFinite(Number(synthesis_agent_id)) ? Number(synthesis_agent_id) : null,
      synthesize: synthesize !== false,
      sessionId: typeof session_id === 'string' ? session_id : undefined,
      userId: typeof user_id === 'string' ? user_id : undefined,
      source: 'api_delegate',
    });
    void workflow.catch(() => undefined);

    const shouldWait = req.query.wait === 'true' || wait === true;
    if (!shouldWait) {
      return res.status(202).json({ parent_execution_id: parentExecutionId, status: 'running' });
    }

    const timeoutMs = typeof waitMs === 'number' && waitMs > 0 ? waitMs : 120000;
    const intervalMs = typeof pollMs === 'number' && pollMs > 0 ? Math.min(pollMs, 5000) : 400;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const exec = await getRuntimeAgentExecution(parentExecutionId);
      if (!exec) return res.status(404).json({ error: 'Delegated execution not found' });
      if (exec.status !== 'running') {
        return res.json({
          parent_execution_id: parentExecutionId,
          status: exec.status,
          output: exec.output || '',
          delegations: await getDelegationRows(parentExecutionId),
        });
      }
      await sleep(intervalMs);
    }

    res.status(202).json({ parent_execution_id: parentExecutionId, status: 'running' });
});

app.post('/api/agents/:id/chat', localRunLimiter, async (req, res) => {
    const agentId = Number(req.params.id);
    const { message, session_id, user_id } = req.body || {};
    const task = typeof message === 'string' ? message.trim() : '';
    if (!task) return res.status(400).json({ error: 'message is required' });

    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    try {
      const jobId = await enqueueJob('run_agent', {
        agentId: agent.id,
        task,
        session_id,
        user_id,
        initiatedBy: 'agent_chat_ui',
      });
      const result = await waitForJob(jobId, 120000);
      res.json({
        session_id: result?.session_id ?? session_id ?? null,
        user_id: result?.user_id ?? user_id ?? null,
        reply: result?.result ?? '',
        execution_id: result?.exec_id ?? null,
        usage: result?.usage ?? null,
        logs: Array.isArray(result?.logs) ? result.logs : [],
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to run chat request' });
    }
});

app.post('/api/agents/:id/chat/stream', localRunLimiter, async (req, res) => {
    const agentId = Number(req.params.id);
    const { message, session_id, user_id } = req.body || {};
    const task = typeof message === 'string' ? message.trim() : '';
    if (!task) return res.status(400).json({ error: 'message is required' });

    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    req.on('close', () => { closed = true; });

    const sendSse = (event: string, payload: any) => {
      if (closed) return;
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(payload ?? {})}\n\n`);
      } catch {
        closed = true;
      }
    };

    const ping = setInterval(() => sendSse('ping', { ts: Date.now() }), 15_000);

    try {
      const session = await ensureAgentSession(agent.id, session_id, user_id);
      sendSse('session', { session_id: session.id, user_id: session.user_id ?? user_id ?? null });
      sendSse('log', { type: 'status', agent: agent.name, message: 'Agent execution started' });

      const result = await runAgent(
        agent,
        { description: task, expected_output: 'The best possible answer.' },
        '',
        (log) => sendSse('log', log),
        {
          initiatedBy: 'agent_chat_ui_stream',
          sessionId: session.id,
          userId: session.user_id ?? user_id,
        }
      );

      sendSse('done', {
        session_id: session.id,
        user_id: session.user_id ?? user_id ?? null,
        reply: result?.text ?? '',
        execution_id: result?.exec_id ?? null,
        usage: result?.usage ?? null,
      });
    } catch (e: any) {
      sendSse('error', { error: e?.message || 'Failed to run chat request' });
    } finally {
      clearInterval(ping);
      if (!closed) res.end();
    }
});

// --- MCP (Model Context Protocol) Support ---
const mcpTransports = new Map<string, { transport: StreamableHTTPServerTransport | SSEServerTransport; scope: string }>();

function normalizeMcpName(name: string, prefix = ''): string {
    const base = name.toLowerCase().replace(/\s+/g, '_');
    return prefix ? `${prefix}${base}` : base;
}

function buildMcpServer(options?: { toolExposedName?: string; bundleSlug?: string }) {
    const scopeTool = options?.toolExposedName?.trim() || '';
    const scopeBundle = options?.bundleSlug?.trim() || '';
    const scope = scopeTool ? `tool:${scopeTool}` : (scopeBundle ? `bundle:${scopeBundle}` : 'all');
    const server = new McpServer(
        { name: 'ai-orchestrator', version: '0.3.0' },
        { capabilities: { logging: {} } }
    );

    const isScopedToolsOnly = Boolean(scopeTool || scopeBundle);
    const exposedAgents = isScopedToolsOnly ? [] : (db.prepare('SELECT * FROM agents WHERE is_exposed = 1').all() as any[]);
    const exposedCrews = isScopedToolsOnly ? [] : (db.prepare('SELECT * FROM crews WHERE is_exposed = 1').all() as any[]);
    const exposedTools = scopeTool
        ? (db.prepare(`
            SELECT e.exposed_name, e.description, t.*
            FROM mcp_exposed_tools e
            JOIN tools t ON t.id = e.tool_id
            WHERE e.exposed_name = ?
            LIMIT 1
        `).all(scopeTool) as any[])
        : scopeBundle
            ? (db.prepare(`
                SELECT e.exposed_name, COALESCE(e.description, t.description) as description, t.*
                FROM mcp_bundle_tools bt
                JOIN mcp_bundles b ON b.id = bt.bundle_id
                JOIN tools t ON t.id = bt.tool_id
                LEFT JOIN mcp_exposed_tools e ON e.tool_id = t.id
                WHERE b.slug = ?
                ORDER BY t.name ASC
            `).all(scopeBundle) as any[])
        : (db.prepare(`
            SELECT e.exposed_name, e.description, t.*
            FROM mcp_exposed_tools e
            JOIN tools t ON t.id = e.tool_id
            ORDER BY e.exposed_name ASC
        `).all() as any[]);

    if ((scopeTool || scopeBundle) && exposedTools.length === 0) {
        throw new Error(scopeTool
            ? `MCP exposed tool not found: ${scopeTool}`
            : `MCP bundle not found or empty: ${scopeBundle}`);
    }

    const agentInput = z.object({
        task: z.string().describe('The task or question for the agent.'),
        session_id: z.string().optional(),
        user_id: z.string().optional()
    });

    const crewInput = z.object({
        kickoff_message: z.string().optional(),
        task: z.string().optional()
    });

    const toolInput = z.object({}).passthrough();

    for (const agent of exposedAgents) {
        const toolName = normalizeMcpName(agent.name);
        server.registerTool(toolName, {
            description: `[AGENT] Role: ${agent.role}. Goal: ${agent.goal}. ${agent.backstory || ''}`,
            inputSchema: agentInput
        }, async ({ task, session_id, user_id }) => {
            const jobId = await enqueueJob('run_agent', {
                agentId: agent.id,
                task,
                session_id,
                user_id,
                initiatedBy: 'mcp_agent_call'
            });
            const result = await waitForJob(jobId, 120000);
            return {
                content: [{ type: 'text', text: result.result ?? '' }]
            };
        });
    }

    for (const crew of exposedCrews) {
        const toolName = normalizeMcpName(crew.name, 'crew_');
        server.registerTool(toolName, {
            description: `[CREW] ${crew.description || 'A collaborative AI crew.'} Process: ${crew.process}.`,
            inputSchema: crewInput
        }, async ({ kickoff_message, task }) => {
            const stmt = db.prepare('INSERT INTO crew_executions (crew_id, status, logs, initial_input, retry_of) VALUES (?, ?, ?, ?, ?)');
            const info = stmt.run(crew.id, 'running', JSON.stringify([]), kickoff_message || task || '', null);
            const executionId = info.lastInsertRowid as number;

            await enqueueJob('run_crew', {
                crewId: crew.id,
                executionId,
                initialInput: kickoff_message || task || "",
                initiatedBy: 'mcp_crew_call'
            });

            const startTime = Date.now();
            while (Date.now() - startTime < 60000) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                const exec = db.prepare('SELECT status FROM crew_executions WHERE id = ?').get(executionId) as any;
                if (exec.status === 'completed' || exec.status === 'failed' || exec.status === 'canceled') {
                    const logs = readCrewExecutionLogs(executionId);
                    const finalResult = extractCrewFinalResult(logs);
                    const message =
                        exec.status === 'failed'
                            ? 'Execution Failed. Check logs.'
                            : exec.status === 'canceled'
                                ? 'Execution Canceled.'
                                : finalResult;
                    return { content: [{ type: 'text', text: message }] };
                }
            }

            return {
                content: [{ type: 'text', text: `Crew execution started (ID: ${executionId}), but timed out waiting for result. Please check dashboard.` }]
            };
        });
    }

    for (const tool of exposedTools) {
        const normalized = normalizeMcpName(String(tool.exposed_name || tool.name));
        const toolName = normalized.startsWith('tool_') ? normalized : `tool_${normalized}`;
        server.registerTool(toolName, {
            description: `[TOOL] ${tool.description || tool.name}`,
            inputSchema: toolInput
        }, async (args) => {
            const result = await executeTool(tool.name, args || {}, undefined, tool);
            return { content: [{ type: 'text', text: result }] };
        });
    }

    console.log(`MCP server built for scope "${scope}" with ${exposedAgents.length} agents, ${exposedCrews.length} crews, ${exposedTools.length} tools`);
    return server;
}

async function handleStreamableMcp(req: express.Request, res: express.Response, options?: { toolExposedName?: string; bundleSlug?: string }) {
    if (!requireMcpAuth(req, res)) return;
    const toolExposedName = options?.toolExposedName;
    const bundleSlug = options?.bundleSlug;
    const scope = toolExposedName ? `tool:${toolExposedName}` : (bundleSlug ? `bundle:${bundleSlug}` : 'all');
    try {
        const sessionId = String(req.headers['mcp-session-id'] || '');
        let transport: StreamableHTTPServerTransport | undefined;
        const existing = sessionId ? mcpTransports.get(sessionId) : undefined;

        if (sessionId && existing?.scope !== scope) {
            res.status(400).json({
                jsonrpc: '2.0',
                error: { code: -32000, message: 'Bad Request: Session exists but uses a different MCP scope' },
                id: null
            });
            return;
        }

        if (sessionId && existing?.transport instanceof StreamableHTTPServerTransport) {
            transport = existing.transport;
        } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
            const server = buildMcpServer({ toolExposedName, bundleSlug });
            const streamTransport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (sid) => {
                    mcpTransports.set(sid, { transport: streamTransport, scope });
                }
            });
            streamTransport.onclose = () => {
                const sid = streamTransport.sessionId;
                if (sid) mcpTransports.delete(sid);
            };
            await server.connect(streamTransport);
            transport = streamTransport;
        } else if (sessionId && existing?.transport instanceof SSEServerTransport) {
            res.status(400).json({
                jsonrpc: '2.0',
                error: { code: -32000, message: 'Bad Request: Session exists but uses a different transport protocol' },
                id: null
            });
            return;
        } else {
            res.status(400).json({
                jsonrpc: '2.0',
                error: { code: -32000, message: 'Bad Request: Missing session ID' },
                id: null
            });
            return;
        }

        await transport.handleRequest(req, res, req.body);
    } catch (error) {
        console.error('Error handling MCP Streamable HTTP request:', error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal server error' },
                id: null
            });
        }
    }
}

// Streamable HTTP (recommended) MCP server
app.all('/mcp', async (req, res) => handleStreamableMcp(req, res));
app.all('/mcp/tool/:exposedName', async (req, res) => handleStreamableMcp(req, res, { toolExposedName: String(req.params.exposedName || '') }));
app.all('/mcp/bundle/:slug', async (req, res) => handleStreamableMcp(req, res, { bundleSlug: String(req.params.slug || '') }));

// Deprecated HTTP + SSE transport (for legacy clients)
async function handleSseConnect(req: express.Request, res: express.Response, options?: { toolExposedName?: string; bundleSlug?: string }) {
    if (!requireMcpAuth(req, res)) return;
    const toolExposedName = options?.toolExposedName;
    const bundleSlug = options?.bundleSlug;
    const scope = toolExposedName ? `tool:${toolExposedName}` : (bundleSlug ? `bundle:${bundleSlug}` : 'all');
    const sseMessagePath = toolExposedName
        ? `/mcp/tool/${encodeURIComponent(toolExposedName)}/messages`
        : bundleSlug
            ? `/mcp/bundle/${encodeURIComponent(bundleSlug)}/messages`
            : '/mcp/messages';
    const transport = new SSEServerTransport(sseMessagePath, res);
    mcpTransports.set(transport.sessionId, { transport, scope });
    res.on('close', () => {
        mcpTransports.delete(transport.sessionId);
    });
    const server = buildMcpServer({ toolExposedName, bundleSlug });
    await server.connect(transport);
}

async function handleSseMessages(req: express.Request, res: express.Response, options?: { toolExposedName?: string; bundleSlug?: string }) {
    if (!requireMcpAuth(req, res)) return;
    const toolExposedName = options?.toolExposedName;
    const bundleSlug = options?.bundleSlug;
    const scope = toolExposedName ? `tool:${toolExposedName}` : (bundleSlug ? `bundle:${bundleSlug}` : 'all');
    const sessionId = String(req.query.sessionId || '');
    const existing = mcpTransports.get(sessionId);
    if (!existing || existing.scope !== scope) {
        res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: Session exists but uses a different MCP scope' },
            id: null
        });
        return;
    }
    if (!(existing.transport instanceof SSEServerTransport)) {
        res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: Session exists but uses a different transport protocol' },
            id: null
        });
        return;
    }
    await existing.transport.handlePostMessage(req, res, req.body);
}

app.get('/mcp/sse', async (req, res) => handleSseConnect(req, res));
app.post('/mcp/messages', async (req, res) => handleSseMessages(req, res));
app.get('/mcp/tool/:exposedName/sse', async (req, res) => handleSseConnect(req, res, { toolExposedName: String(req.params.exposedName || '') }));
app.post('/mcp/tool/:exposedName/messages', async (req, res) => handleSseMessages(req, res, { toolExposedName: String(req.params.exposedName || '') }));
app.get('/mcp/bundle/:slug/sse', async (req, res) => handleSseConnect(req, res, { bundleSlug: String(req.params.slug || '') }));
app.post('/mcp/bundle/:slug/messages', async (req, res) => handleSseMessages(req, res, { bundleSlug: String(req.params.slug || '') }));
app.get('/mcp/manifest', (req, res) => {
    if (!requireMcpAuth(req, res)) return;
    const exposedAgents = db.prepare('SELECT * FROM agents WHERE is_exposed = 1').all() as any[];
    const exposedCrews = db.prepare('SELECT * FROM crews WHERE is_exposed = 1').all() as any[];
    const exposedTools = db.prepare(`
        SELECT e.exposed_name, e.description, t.id, t.name
        FROM mcp_exposed_tools e
        JOIN tools t ON t.id = e.tool_id
        ORDER BY e.exposed_name ASC
    `).all() as any[];
    
    const agentTools = exposedAgents.map(agent => ({
        name: agent.name.toLowerCase().replace(/\s+/g, '_'),
        description: `[AGENT] Role: ${agent.role}. Goal: ${agent.goal}. ${agent.backstory || ''}`,
        inputSchema: {
            type: "object",
            properties: {
                task: {
                    type: "string",
                    description: "The task or question for the agent"
                }
            },
            required: ["task"]
        }
    }));

    const crewTools = exposedCrews.map(crew => ({
        name: `crew_${crew.name.toLowerCase().replace(/\s+/g, '_')}`,
        description: `[CREW] ${crew.description || 'A collaborative AI crew.'} Process: ${crew.process}.`,
        inputSchema: {
            type: "object",
            properties: {
                kickoff_message: {
                    type: "string",
                    description: "Optional initial input or context for the crew execution."
                }
            }
        }
    }));

    const toolTools = exposedTools.map(t => ({
        name: `tool_${t.exposed_name}`,
        description: `[TOOL] ${t.description || t.name}`,
        inputSchema: {
            type: "object",
            description: "Arguments for the tool call.",
            additionalProperties: true
        }
    }));

    res.json({
        schema_version: "1.0",
        name: "Orchestrator Agents & Crews",
        description: "Exposed agents, crews, and tools from the AI Orchestrator",
        tools: [...agentTools, ...crewTools, ...toolTools]
    });
});

app.post('/mcp/call/:toolName', localRunLimiter, async (req, res) => {
    if (!requireMcpAuth(req, res)) return;
    const toolName = req.params.toolName;
    const { task, kickoff_message, session_id, user_id, args } = req.body || {};

    if (toolName.startsWith('tool_')) {
        const exposedName = toolName.replace('tool_', '');
        const row = db.prepare(`
            SELECT t.* FROM mcp_exposed_tools e
            JOIN tools t ON t.id = e.tool_id
            WHERE e.exposed_name = ?
        `).get(exposedName) as any;
        if (!row) return res.status(404).json({ error: "Tool (MCP) not found" });
        try {
            const result = await executeTool(row.name, args || {}, undefined, row);
            return res.json({ content: [{ type: "text", text: result }] });
        } catch (e: any) {
            return res.status(500).json({ error: e.message || 'Tool execution failed' });
        }
    }

    // Check if it's a crew
    if (toolName.startsWith('crew_')) {
        const crewName = toolName.replace('crew_', '').replace(/_/g, ' ');
        // Try exact match or fuzzy match
        const crews = db.prepare('SELECT * FROM crews WHERE is_exposed = 1').all() as any[];
        const crew = crews.find(c => c.name.toLowerCase().replace(/\s+/g, '_') === toolName.replace('crew_', ''));

        if (!crew) return res.status(404).json({ error: "Tool (Crew) not found" });

        const stmt = db.prepare('INSERT INTO crew_executions (crew_id, status, logs, initial_input, retry_of) VALUES (?, ?, ?, ?, ?)');
        const info = stmt.run(crew.id, 'running', JSON.stringify([]), kickoff_message || task || '', null);
        const executionId = info.lastInsertRowid;

        // Start background process (same as kickoff endpoint)
        await enqueueJob('run_crew', {
          crewId: crew.id,
          executionId,
          initialInput: kickoff_message || task || "",
          initiatedBy: 'mcp_crew_call',
        });

        // Poll for completion (timeout 60s)
        const startTime = Date.now();
        while (Date.now() - startTime < 60000) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const exec = db.prepare('SELECT status FROM crew_executions WHERE id = ?').get(executionId) as any;
            if (exec.status === 'completed' || exec.status === 'failed' || exec.status === 'canceled') {
                const logs = readCrewExecutionLogs(executionId);
                const finalResult = extractCrewFinalResult(logs);
                
                const message =
                  exec.status === 'failed'
                    ? "Execution Failed. Check logs."
                    : exec.status === 'canceled'
                      ? "Execution Canceled."
                      : finalResult;
                return res.json({
                    content: [{ type: "text", text: message }]
                });
            }
        }

        return res.json({
            content: [{ type: "text", text: `Crew execution started (ID: ${executionId}), but timed out waiting for result. Please check dashboard.` }]
        });
    }

    // Find agent by name (approximate)
    const agents = db.prepare('SELECT * FROM agents WHERE is_exposed = 1').all() as any[];
    const agent = agents.find(a => a.name.toLowerCase().replace(/\s+/g, '_') === toolName);

    if (!agent) return res.status(404).json({ error: "Tool (Agent) not found" });

    try {
        const jobId = await enqueueJob('run_agent', {
          agentId: agent.id,
          task,
          session_id,
          user_id,
          initiatedBy: 'mcp_agent_call',
        });
        const result = await waitForJob(jobId, 120000);
        res.json({
          content: [{ type: "text", text: result.result ?? '' }],
          session_id: result.session_id ?? null,
          user_id: result.user_id ?? user_id ?? null,
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// --- Agents ---
app.post('/api/agents/autobuild', async (req, res) => {
    try {
        const { goal, project_id, provider = 'google', model = 'gemini-1.5-flash', stream = false, agent_role_preference = 'auto' } = req.body;

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders();
        }

        const sendEvent = (type: string, data: any) => {
            if (!stream) return;
            try {
                res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
            } catch (e) {
                console.error("Failed to write to stream", e);
            }
        };

        sendEvent('status', { message: 'Analyzing agent requirements...', step: 1 });
        
        const config = await getProviderConfig(provider);
        const apiKey = config.apiKey;

        if (!apiKey) {
            const error = `API Key not configured for provider: ${provider}`;
            if (stream) {
                sendEvent('error', { message: error });
                return res.end();
            }
            return res.status(500).json({ error });
        }

        sendEvent('status', { message: 'Designing your specialist...', step: 2 });

        const prompt = `
        You are an expert AI Agent Architect.
        Your goal is to design a single, highly specialized AI agent to accomplish a specific objective.

        User's Objective: "${goal}"
        Role Preference: "${agent_role_preference}"

        Instructions:
        1. Analyze the User's Objective.
        2. Decide whether this should be a "specialist" agent or a "supervisor" agent.
        2a. If Role Preference is "specialist" or "supervisor", strongly prefer that unless it would make the design clearly incoherent.
        2b. If Role Preference is "auto", choose the best architecture yourself.
        3. A supervisor agent should decompose work, coordinate other agents, and synthesize outputs.
        4. A specialist agent should focus on direct execution of a narrow task.
        5. Define a descriptive name, a clear role, an internal agent_role, a specific goal, and a deep backstory for the agent.
        6. Provide an expert system prompt that guides the agent's behavior.

        Response Format (JSON only):
        {
            "name": "Agent Name",
            "role": "Agent Role (e.g. Senior Research Analyst)",
            "agent_role": "supervisor or specialist",
            "goal": "Core objective of the agent",
            "backstory": "Context and personality of the agent",
            "system_prompt": "Detailed system instructions"
        }
        `;

        let text = '';
        if (config.providerType === 'google') {
            const ai = new GoogleGenAI({ apiKey });
            const response = await withRetry(() => ai.models.generateContent({
                model: model,
                contents: prompt,
                config: { responseMimeType: 'application/json' }
            }));
            text = response.text;
        } else if (config.providerType === 'openai') {
            const openai = new OpenAI({ apiKey, baseURL: config.apiBase });
            const response = await withRetry(() => openai.chat.completions.create({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" }
            }));
            text = response.choices[0].message.content || '';
        } else if (config.providerType === 'anthropic') {
            const anthropic = new Anthropic({ apiKey, baseURL: config.apiBase });
            const response = await withRetry(() => anthropic.messages.create({
                model: model,
                max_tokens: 4096,
                messages: [{ role: 'user', content: prompt }]
            }));
            if (response.content[0].type === 'text') {
                text = response.content[0].text;
            }
        }

        let design;
        try {
            design = JSON.parse(text);
        } catch (e) {
            const jsonString = text.replace(/```json\n?|\n?```/g, "").trim();
            design = JSON.parse(jsonString);
        }

        sendEvent('status', { message: 'Deploying agent...', step: 3, design });

        const purifiedProjectId = project_id && !isNaN(Number(project_id)) ? Number(project_id) : null;

        const created = await getPrisma().orchestratorAgent.create({
            data: {
                name: design.name,
                role: design.role,
                agentRole: String(design.agent_role || '').trim() || 'specialist',
                goal: design.goal,
                backstory: design.backstory,
                systemPrompt: design.system_prompt,
                model,
                provider,
                projectId: purifiedProjectId,
            }
        });
        await refreshPersistentMirror();

        const id = created.id;

        if (stream) {
            sendEvent('done', { id });
            res.end();
        } else {
            res.status(200).json({ id });
        }
    } catch (e: any) {
        console.error("Agent auto-build error:", e);
        if (res.headersSent) {
            if (req.body.stream) {
                res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
                res.end();
            }
        } else {
            res.status(500).json({ error: e.message });
        }
    }
});

// --- Crews ---
app.post('/api/crews/autobuild', async (req, res) => {
    try {
        const { goal, project_id, provider = 'google', model = 'gemini-1.5-flash', stream = false, process_preference = 'auto' } = req.body;
        
        console.log(`Auto-build request received. Provider: ${provider}, Model: ${model}, Stream: ${stream}`);

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders();
        }

        const sendEvent = (type: string, data: any) => {
            if (!stream) return;
            try {
                res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
            } catch (e) {
                console.error("Failed to write to stream", e);
            }
        };

        sendEvent('status', { message: 'Analyzing objective and library...', step: 1 });
        
        const config = await getProviderConfig(provider);
        const apiKey = config.apiKey;

        if (!apiKey) {
            const error = `API Key not configured for provider: ${provider}`;
            if (stream) {
                sendEvent('error', { message: error });
                return res.end();
            }
            return res.status(500).json({ error });
        }

        // 1. Fetch all available agents
        const prisma = getPrisma();
        const agents = await prisma.orchestratorAgent.findMany({
          select: { id: true, name: true, role: true, goal: true, backstory: true, model: true, provider: true }
        });

        sendEvent('status', { message: 'Architecting your crew...', step: 2 });

        const prompt = `
        You are an expert AI Team Architect.
        Your goal is to design a high-performing team (Crew) of AI agents to accomplish a specific objective.

        User's Objective: "${goal}"
        Process Preference: "${process_preference}"

        Available Agent Library:
        ${JSON.stringify(agents)}

        Instructions:
        1. Analyze the User's Objective.
        2. Design a crew to accomplish this objective.
        3. You can reuse existing agents from the library AND/OR define NEW agents that need to be created.
        4. PRIORITIZE using existing agents if they are a good fit.
        5. If existing agents are sufficient, use them. If not, create new specialized agents.
        6. Define a name and description for this crew.
        7. Define a process (sequential or hierarchical).
        7a. If Process Preference is "sequential" or "hierarchical", strongly prefer that unless it would make the design clearly incoherent.
        7b. If Process Preference is "auto", choose the best process yourself.
        8. If the process is hierarchical, explicitly choose a coordinator/supervisor agent and return its temp id as coordinator_temp_id.
        9. Break down the objective into a series of specific tasks. Assign each task to an agent (either existing or new).
        10. For new agents, include an agent_role of either "supervisor" or "specialist". Hierarchical crews should usually have exactly one supervisor.

        Response Format (JSON only):
        {
            "crew_name": "Name of the crew",
            "crew_description": "Description of what this crew does",
            "process": "sequential",
            "coordinator_temp_id": "agent_1",
            "agents": [
                {
                    "temp_id": "agent_1",
                    "existing_agent_id": 123, // Optional: ONLY if using an existing agent from the library
                    "agent_role": "supervisor", // Optional for existing agents, required for new agents in hierarchical crews
                    "name": "Agent Name", // Required if new
                    "role": "Agent Role", // Required if new
                    "goal": "Agent Goal", // Required if new
                    "backstory": "Agent Backstory" // Required if new
                }
            ],
            "tasks": [
                {
                    "description": "Detailed task description",
                    "expected_output": "What the task should produce",
                    "assigned_to_temp_id": "agent_1" // Must match one of the temp_ids in the agents list
                }
            ]
        }
        `;

        let text = '';
        if (config.providerType === 'google') {
            const ai = new GoogleGenAI({ apiKey });
            const response = await withRetry(() => ai.models.generateContent({
                model: model,
                contents: prompt,
                config: { responseMimeType: 'application/json' }
            }));
            text = response.text;
        } else if (config.providerType === 'openai') {
            const openai = new OpenAI({ apiKey, baseURL: config.apiBase });
            const response = await withRetry(() => openai.chat.completions.create({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" }
            }));
            text = response.choices[0].message.content || '';
        } else if (config.providerType === 'anthropic') {
            const anthropic = new Anthropic({ apiKey, baseURL: config.apiBase });
            const response = await withRetry(() => anthropic.messages.create({
                model: model,
                max_tokens: 4096,
                messages: [{ role: 'user', content: prompt }]
            }));
            if (response.content[0].type === 'text') {
                text = response.content[0].text;
            }
        } else {
             throw new Error(`Provider ${config.providerType} not fully supported for auto-build yet.`);
        }

        let design;
        try {
            design = JSON.parse(text);
        } catch (e) {
            const jsonString = text.replace(/```json\n?|\n?```/g, "").trim();
            design = JSON.parse(jsonString);
        }

        if (!design.agents || !Array.isArray(design.agents)) throw new Error("Invalid design: 'agents' array is missing");
        if (!design.tasks || !Array.isArray(design.tasks)) throw new Error("Invalid design: 'tasks' array is missing");

        const normalizedProcess = design.process === 'hierarchical' ? 'hierarchical' : 'sequential';
        const normalizedAgents = design.agents.map((agentDef: any, idx: number) => ({
            ...agentDef,
            temp_id: String(agentDef?.temp_id || `agent_${idx + 1}`),
        }));
        const validTempIds = new Set(normalizedAgents.map((a: any) => a.temp_id));
        const normalizedTasks = design.tasks
          .map((task: any, idx: number) => {
            const fallbackTempId = normalizedAgents[0]?.temp_id;
            const assigned = validTempIds.has(String(task?.assigned_to_temp_id))
              ? String(task.assigned_to_temp_id)
              : fallbackTempId;
            if (!assigned) return null;
            return {
              description: String(task?.description || `Task ${idx + 1}`),
              expected_output: String(task?.expected_output || 'Completed task output'),
              assigned_to_temp_id: assigned,
            };
          })
          .filter(Boolean) as Array<{ description: string; expected_output: string; assigned_to_temp_id: string }>;

        if (!normalizedAgents.length) throw new Error("Invalid design: no agents generated");
        if (!normalizedTasks.length) throw new Error("Invalid design: no valid tasks generated");
        
        sendEvent('status', { message: 'Deploying crew and agents...', step: 3, design });

        const purifiedProjectId = project_id && !isNaN(Number(project_id)) ? Number(project_id) : null;
        const requestedCoordinatorTempId = normalizedProcess === 'hierarchical'
          ? (validTempIds.has(String(design?.coordinator_temp_id || '')) ? String(design.coordinator_temp_id) : null)
          : null;
        const supervisorAgentTempId = normalizedProcess === 'hierarchical'
          ? (
              normalizedAgents.find((agentDef: any) => String(agentDef?.agent_role || '').toLowerCase() === 'supervisor')?.temp_id ||
              null
            )
          : null;
        const proposedCoordinatorTempId = normalizedProcess === 'hierarchical'
          ? (requestedCoordinatorTempId || supervisorAgentTempId || normalizedTasks[0]?.assigned_to_temp_id || normalizedAgents[0]?.temp_id || null)
          : null;

        const createdCrew = await prisma.orchestratorCrew.create({
          data: {
            name: design.crew_name || `Auto-Crew for: ${goal.substring(0, 30)}...`,
            description: design.crew_description,
            process: normalizedProcess,
            projectId: purifiedProjectId,
            coordinatorAgentId: null,
          }
        });
        const crewId = createdCrew.id;

        const agentIdMap = new Map<string, number>();
        for (const agentDef of normalizedAgents) {
            let realAgentId = Number(agentDef.existing_agent_id);
            if (!Number.isFinite(realAgentId) || realAgentId <= 0) realAgentId = 0;

            if (!realAgentId) {
                const systemPrompt = `You are ${agentDef.name}, ${agentDef.role}. Your goal is: ${agentDef.goal}. Backstory: ${agentDef.backstory}`;
                const createdAgent = await prisma.orchestratorAgent.create({
                  data: {
                    name: agentDef.name,
                    role: agentDef.role,
                    agentRole: String(agentDef?.agent_role || (proposedCoordinatorTempId && agentDef.temp_id === proposedCoordinatorTempId ? 'supervisor' : 'specialist')).trim(),
                    goal: agentDef.goal,
                    backstory: agentDef.backstory,
                    systemPrompt,
                    model,
                    provider,
                    projectId: purifiedProjectId,
                  }
                });
                realAgentId = createdAgent.id;
            }

            agentIdMap.set(agentDef.temp_id, realAgentId);
        }

        const crewAgentRows = Array.from(agentIdMap.values()).map((agentId) => ({ crewId, agentId }));
        if (crewAgentRows.length) {
          await prisma.orchestratorCrewAgent.createMany({ data: crewAgentRows, skipDuplicates: true });
        }

        const taskRows = normalizedTasks
          .map((task) => {
            const agentId = agentIdMap.get(task.assigned_to_temp_id);
            if (!agentId) return null;
            return {
              description: task.description,
              expectedOutput: task.expected_output,
              agentId,
              crewId,
            };
          })
          .filter(Boolean) as Array<{ description: string; expectedOutput: string; agentId: number; crewId: number }>;
        if (taskRows.length) {
          await prisma.orchestratorTask.createMany({ data: taskRows });
        }

        if (normalizedProcess === 'hierarchical' && proposedCoordinatorTempId) {
            const coordinatorId = agentIdMap.get(proposedCoordinatorTempId) || null;
            if (coordinatorId) {
              await prisma.orchestratorCrew.update({
                where: { id: crewId },
                data: { coordinatorAgentId: coordinatorId, updatedAt: new Date() },
              });
            }
        }

        await refreshPersistentMirror();
        const id = crewId;

        if (stream) {
            sendEvent('done', { id });
            res.end();
        } else {
            res.status(200).json({ id });
        }
    } catch (e: any) {
        console.error("Auto-build error:", e);
        if (res.headersSent) {
            if (req.body.stream) {
                res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
                res.end();
            }
        } else {
            res.status(500).json({ error: e.message });
        }
    }
});

app.get('/api/crews', async (req, res) => {
  try {
    const prisma = getPrisma();
    const [crews, crewAgents, agents] = await Promise.all([
      prisma.orchestratorCrew.findMany({ orderBy: { id: 'asc' } }),
      prisma.orchestratorCrewAgent.findMany({ orderBy: [{ crewId: 'asc' }, { agentId: 'asc' }] }),
      prisma.orchestratorAgent.findMany({ orderBy: { id: 'asc' } }),
    ]);
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const agentsByCrewId = new Map<number, any[]>();
    for (const row of crewAgents) {
      const agent = agentById.get(row.agentId);
      if (!agent) continue;
      if (!agentsByCrewId.has(row.crewId)) agentsByCrewId.set(row.crewId, []);
      agentsByCrewId.get(row.crewId)!.push({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        agent_role: agent.agentRole,
        status: agent.status,
        goal: agent.goal,
        backstory: agent.backstory,
        system_prompt: agent.systemPrompt,
        model: agent.model,
        provider: agent.provider,
        temperature: agent.temperature,
        max_tokens: agent.maxTokens,
        memory_window: agent.memoryWindow,
        max_iterations: agent.maxIterations,
        tools_enabled: agent.toolsEnabled,
        retry_policy: agent.retryPolicy,
        timeout_ms: agent.timeoutMs,
        is_exposed: agent.isExposed,
        project_id: agent.projectId,
        created_at: agent.createdAt,
        updated_at: agent.updatedAt,
      });
    }
    res.json(crews.map((crew) => {
      const coordinatorAgent = crew.coordinatorAgentId ? agentById.get(crew.coordinatorAgentId) : null;
      return {
        id: crew.id,
        name: crew.name,
        process: crew.process,
        coordinator_agent_id: crew.coordinatorAgentId,
        project_id: crew.projectId,
        is_exposed: crew.isExposed,
        description: crew.description,
        max_runtime_ms: crew.maxRuntimeMs,
        max_cost_usd: crew.maxCostUsd,
        max_tool_calls: crew.maxToolCalls,
        created_at: crew.createdAt,
        updated_at: crew.updatedAt,
        agents: agentsByCrewId.get(crew.id) || [],
        coordinator_agent: coordinatorAgent ? {
          id: coordinatorAgent.id,
          name: coordinatorAgent.name,
          role: coordinatorAgent.role,
        } : null,
      };
    }));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/crew-templates', (_req, res) => {
  const templates = [
    {
      id: 'research_brief',
      name: 'Research Brief Squad',
      process: 'sequential',
      description: 'Research -> Synthesis -> Executive summary',
      tasks: [
        { description: 'Research the topic and gather facts with citations', expected_output: 'Structured fact list with references', role_hint: 'research' },
        { description: 'Synthesize findings into a strategic brief', expected_output: 'A concise strategic brief', role_hint: 'analyst' },
        { description: 'Produce executive summary and action points', expected_output: 'Executive summary with recommendations', role_hint: 'writer' },
      ],
    },
    {
      id: 'incident_response',
      name: 'Incident Response Pod',
      process: 'hierarchical',
      description: 'Triage -> Root cause -> Mitigation plan',
      tasks: [
        { description: 'Triage incident severity and impact scope', expected_output: 'Incident severity report', role_hint: 'ops' },
        { description: 'Perform root-cause analysis from available logs', expected_output: 'Root cause hypothesis list', role_hint: 'engineer' },
        { description: 'Draft mitigation and rollback playbook', expected_output: 'Stepwise mitigation plan', role_hint: 'planner' },
      ],
    },
    {
      id: 'growth_campaign',
      name: 'Growth Campaign Cell',
      process: 'sequential',
      description: 'Audience -> Messaging -> Channel plan',
      tasks: [
        { description: 'Define target audience segments and motivations', expected_output: 'Segment matrix', role_hint: 'marketing' },
        { description: 'Craft campaign messaging and creative angles', expected_output: 'Message framework', role_hint: 'copy' },
        { description: 'Build channel and budget distribution plan', expected_output: 'Channel plan with budget splits', role_hint: 'media' },
      ],
    },
  ];
  res.json(templates);
});

app.post('/api/crews/from-template', async (req, res) => {
  const { template_id, project_id } = req.body || {};
  if (!template_id || typeof template_id !== 'string') return res.status(400).json({ error: 'template_id is required' });
  const templatesRes: any[] = [
    {
      id: 'research_brief',
      name: 'Research Brief Squad',
      process: 'sequential',
      description: 'Research -> Synthesis -> Executive summary',
      tasks: [
        { description: 'Research the topic and gather facts with citations', expected_output: 'Structured fact list with references', role_hint: 'research' },
        { description: 'Synthesize findings into a strategic brief', expected_output: 'A concise strategic brief', role_hint: 'analyst' },
        { description: 'Produce executive summary and action points', expected_output: 'Executive summary with recommendations', role_hint: 'writer' },
      ],
    },
    {
      id: 'incident_response',
      name: 'Incident Response Pod',
      process: 'hierarchical',
      description: 'Triage -> Root cause -> Mitigation plan',
      tasks: [
        { description: 'Triage incident severity and impact scope', expected_output: 'Incident severity report', role_hint: 'ops' },
        { description: 'Perform root-cause analysis from available logs', expected_output: 'Root cause hypothesis list', role_hint: 'engineer' },
        { description: 'Draft mitigation and rollback playbook', expected_output: 'Stepwise mitigation plan', role_hint: 'planner' },
      ],
    },
    {
      id: 'growth_campaign',
      name: 'Growth Campaign Cell',
      process: 'sequential',
      description: 'Audience -> Messaging -> Channel plan',
      tasks: [
        { description: 'Define target audience segments and motivations', expected_output: 'Segment matrix', role_hint: 'marketing' },
        { description: 'Craft campaign messaging and creative angles', expected_output: 'Message framework', role_hint: 'copy' },
        { description: 'Build channel and budget distribution plan', expected_output: 'Channel plan with budget splits', role_hint: 'media' },
      ],
    },
  ];
  const tpl = templatesRes.find((t) => t.id === template_id);
  if (!tpl) return res.status(404).json({ error: 'Template not found' });

  const allAgents = db.prepare('SELECT * FROM agents ORDER BY id ASC').all() as any[];
  if (!allAgents.length) return res.status(400).json({ error: 'Create at least one agent before using templates' });

  try {
    const prisma = getPrisma();
    const coordinatorHintRole = tpl.process === 'hierarchical' ? String(tpl.tasks?.[0]?.role_hint || '') : '';
    const coordinatorFromHints = coordinatorHintRole
      ? allAgents.find((a: any) =>
          String(a.role || '').toLowerCase().includes(coordinatorHintRole.toLowerCase()) ||
          String(a.name || '').toLowerCase().includes(coordinatorHintRole.toLowerCase())
        )
      : null;

    const crew = await prisma.orchestratorCrew.create({
      data: {
        name: tpl.name,
        description: tpl.description,
        process: tpl.process,
        projectId: project_id || null,
        isExposed: false,
        maxRuntimeMs: 120000,
        maxCostUsd: 5.0,
        maxToolCalls: 20,
        coordinatorAgentId: tpl.process === 'hierarchical' ? (coordinatorFromHints?.id ?? allAgents[0]?.id ?? null) : null,
      },
    });
    const crewId = crew.id;
    const taskData: any[] = [];
    for (const task of tpl.tasks) {
      const assigned = allAgents.find((a: any) =>
        String(a.role || '').toLowerCase().includes(String(task.role_hint || '').toLowerCase()) ||
        String(a.name || '').toLowerCase().includes(String(task.role_hint || '').toLowerCase())
      ) || allAgents[0];
      taskData.push({
        description: task.description,
        expectedOutput: task.expected_output,
        agentId: assigned.id,
        crewId,
      });
    }
    if (taskData.length) await prisma.orchestratorTask.createMany({ data: taskData });
    await refreshPersistentMirror();
    res.json({ id: crewId, template_id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/crews', async (req, res) => {
  const { name, description, process, agentIds, project_id, is_exposed, max_runtime_ms, max_cost_usd, max_tool_calls, coordinator_agent_id } = req.body;
  const normalizedProcess = process === 'hierarchical' ? 'hierarchical' : 'sequential';
  const normalizedAgentIds = Array.isArray(agentIds)
    ? Array.from(new Set(agentIds.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id))))
    : [];
  const coordinatorId = Number(coordinator_agent_id);
  const normalizedCoordinatorId = Number.isFinite(coordinatorId) ? coordinatorId : null;
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Crew name is required' });
  if (normalizedAgentIds.length === 0) return res.status(400).json({ error: 'Select at least one agent for the crew' });
  if (normalizedProcess === 'hierarchical' && normalizedAgentIds.length < 2) {
    return res.status(400).json({ error: 'Hierarchical crews require at least two agents' });
  }
  if (normalizedCoordinatorId != null && !normalizedAgentIds.includes(normalizedCoordinatorId)) {
    return res.status(400).json({ error: 'Coordinator agent must be one of the selected crew agents' });
  }

  try {
    const prisma = getPrisma();
    const crew = await prisma.orchestratorCrew.create({
      data: {
        name,
        description: description || '',
        process: normalizedProcess,
        projectId: project_id || null,
        isExposed: Boolean(is_exposed),
        maxRuntimeMs: normalizeNumber(max_runtime_ms),
        maxCostUsd: normalizeNumber(max_cost_usd),
        maxToolCalls: normalizeNumber(max_tool_calls),
        coordinatorAgentId: normalizedProcess === 'hierarchical'
          ? (normalizedCoordinatorId ?? normalizedAgentIds[0] ?? null)
          : (normalizedCoordinatorId ?? null),
      },
    });
    const crewId = crew.id;

    await prisma.orchestratorCrewAgent.createMany({
      data: normalizedAgentIds.map((agentId: number) => ({ crewId, agentId })),
      skipDuplicates: true,
    });

    const agentRowStmt = db.prepare('SELECT id, name, role FROM agents WHERE id = ?');
    const orderedAgents = normalizedAgentIds
      .map((agentId: number) => agentRowStmt.get(agentId) as any)
      .filter(Boolean);
    if (orderedAgents.length) {
      await prisma.orchestratorTask.createMany({
        data: orderedAgents.map((agent: any, i: number) => {
          const isCoordinatorStep = normalizedProcess === 'hierarchical' && i === 0;
          return {
            description: isCoordinatorStep
              ? 'Plan and coordinate the objective. Break work into delegated sub-goals and provide explicit handoff instructions for downstream agents.'
              : `Execute step ${i + 1} as ${agent.role || 'specialist'} and provide a structured handoff for the next agent.`,
            expectedOutput: isCoordinatorStep
              ? 'A coordination plan with delegated objectives and success criteria.'
              : 'Concrete output for this step, plus concise handoff notes for downstream synthesis.',
            agentId: agent.id,
            crewId,
          };
        }),
      });
    }
    await refreshPersistentMirror();
    res.json({ id: crewId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/crews/:id', async (req, res) => {
    const { name, description, process, agentIds, project_id, is_exposed, max_runtime_ms, max_cost_usd, max_tool_calls, coordinator_agent_id } = req.body;
    const normalizedProcess = process === 'hierarchical' ? 'hierarchical' : 'sequential';
    const normalizedAgentIds = Array.isArray(agentIds)
      ? Array.from(new Set(agentIds.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id))))
      : [];
    const coordinatorId = Number(coordinator_agent_id);
    const normalizedCoordinatorId = Number.isFinite(coordinatorId) ? coordinatorId : null;
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Crew name is required' });
    if (normalizedAgentIds.length === 0) return res.status(400).json({ error: 'Select at least one agent for the crew' });
    if (normalizedProcess === 'hierarchical' && normalizedAgentIds.length < 2) {
      return res.status(400).json({ error: 'Hierarchical crews require at least two agents' });
    }
    if (normalizedCoordinatorId != null && !normalizedAgentIds.includes(normalizedCoordinatorId)) {
      return res.status(400).json({ error: 'Coordinator agent must be one of the selected crew agents' });
    }

    try {
      const prisma = getPrisma();
      const crewId = Number(req.params.id);
      await prisma.orchestratorCrew.update({
        where: { id: crewId },
        data: {
          name,
          description: description || '',
          process: normalizedProcess,
          projectId: project_id || null,
          isExposed: Boolean(is_exposed),
          maxRuntimeMs: normalizeNumber(max_runtime_ms),
          maxCostUsd: normalizeNumber(max_cost_usd),
          maxToolCalls: normalizeNumber(max_tool_calls),
          coordinatorAgentId: normalizedProcess === 'hierarchical'
            ? (normalizedCoordinatorId ?? normalizedAgentIds[0] ?? null)
            : (normalizedCoordinatorId ?? null),
          updatedAt: new Date(),
        },
      });

      await prisma.orchestratorCrewAgent.deleteMany({ where: { crewId } });
      await prisma.orchestratorCrewAgent.createMany({
        data: normalizedAgentIds.map((agentId: number) => ({ crewId, agentId })),
        skipDuplicates: true,
      });
      await refreshPersistentMirror();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
});

app.delete('/api/crews/:id', async (req, res) => {
    console.log(`Deleting crew ${req.params.id}`);
    try {
        const crewId = Number(req.params.id);
        const prisma = getPrisma();
        await prisma.orchestratorCrewExecution.deleteMany({ where: { crewId } });
        await refreshPersistentMirror();
        // Mirror to SQLite
        try { db.prepare('DELETE FROM crew_executions WHERE crew_id = ?').run(crewId); } catch {}
        console.log(`Crew ${crewId} deleted successfully`);
        res.json({ success: true });
    } catch (e: any) {
        console.error("Error deleting crew:", e);
        res.status(500).json({ error: e.message });
    }
});

// --- Tasks ---
app.get('/api/tasks', (req, res) => {
  const { crew_id } = req.query;
  if (crew_id) {
    const tasks = db.prepare('SELECT * FROM tasks WHERE crew_id = ?').all(crew_id);
    res.json(tasks);
  } else {
    const tasks = db.prepare('SELECT * FROM tasks').all();
    res.json(tasks);
  }
});

app.post('/api/tasks', async (req, res) => {
  const { description, expected_output, agent_id, crew_id } = req.body;
  try {
    const created = await getPrisma().orchestratorTask.create({
      data: {
        description,
        expectedOutput: expected_output,
        agentId: agent_id ?? null,
        crewId: crew_id ?? null,
      },
    });
    await refreshPersistentMirror();
    res.json({ id: created.id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/tasks/:id', async (req, res) => {
    const { description, expected_output, agent_id } = req.body;
    try {
      await getPrisma().orchestratorTask.update({
        where: { id: Number(req.params.id) },
        data: {
          description,
          expectedOutput: expected_output,
          agentId: agent_id ?? null,
          updatedAt: new Date(),
        },
      });
      await refreshPersistentMirror();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
});

app.delete('/api/tasks/:id', async (req, res) => {
    try {
        await getPrisma().orchestratorTask.delete({ where: { id: Number(req.params.id) } });
        await refreshPersistentMirror();
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});


// --- Execution Logic ---

function getByPath(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, key) => (acc != null ? acc[key] : undefined), obj);
}

function applyTemplate(input: string, args: any): string {
  return input.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key) => {
    if (key === 'args') return JSON.stringify(args ?? {});
    const normalized = key.startsWith('args.') ? key.slice(5) : key;
    const val = getByPath(args, normalized);
    return val == null ? '' : String(val);
  });
}

async function runPythonTool(code: string, args: any): Promise<string> {
  const pythonBin = process.env.PYTHON_BIN || 'python3';
  const header = `import json, os\nargs = json.loads(os.environ.get("TOOL_ARGS", "{}"))\n`;
  const script = `${header}\n${code}\n`;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let finished = false;
    const proc = spawn(pythonBin, ['-'], {
      env: { ...process.env, TOOL_ARGS: JSON.stringify(args ?? {}) }
    });

    const timeoutMs = 15000;
    const timeout = setTimeout(() => {
      if (!finished) {
        proc.kill('SIGKILL');
      }
    }, timeoutMs);

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      if (finished) return;
      finished = true;
      resolve(`[Python Error] ${err.message}`);
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (finished) return;
      finished = true;
      if (code !== 0) {
        resolve(`[Python Error] ${stderr || `Exited with code ${code}`}`);
        return;
      }
      resolve(stdout.trim() || stderr.trim() || '');
    });

    proc.stdin.write(script);
    proc.stdin.end();
  });
}

async function runHttpTool(config: any, args: any): Promise<string> {
  const method = String(config?.method || 'GET').toUpperCase();
  let url = String(config?.url || '');
  if (!url) throw new Error('HTTP tool URL is required.');
  if (args && typeof args === 'object') {
    url = applyTemplate(url, args);
  }

  const headers: Record<string, string> = { ...(config?.headers || {}) };
  if (args && typeof args === 'object') {
    for (const key of Object.keys(headers)) {
      const val = headers[key];
      if (typeof val === 'string') headers[key] = applyTemplate(val, args);
    }
  }
  const auth = config?.auth || {};
  const authType = String(auth?.type || 'none');
  const parsedCredentialId = Number(auth?.credentialId);
  const credentialRow = Number.isFinite(parsedCredentialId)
    ? (db.prepare('SELECT provider, name, key_name, api_key FROM credentials WHERE id = ?').get(parsedCredentialId) as any)
    : undefined;
  const credentialApiKey = credentialRow?.api_key;
  const templateIfNeeded = (value: any) => {
    if (typeof value !== 'string') return '';
    return (args && typeof args === 'object') ? applyTemplate(value, args) : value;
  };
  if (authType === 'bearer') {
    const token = templateIfNeeded(auth?.token) || credentialApiKey || '';
    if (token && !headers.Authorization && !(headers as any).authorization) {
      headers.Authorization = `Bearer ${token}`;
    }
  } else if (authType === 'basic') {
    const username = templateIfNeeded(auth?.username);
    const password = templateIfNeeded(auth?.password) || credentialApiKey || '';
    if ((username || password) && !headers.Authorization && !(headers as any).authorization) {
      const basic = Buffer.from(`${username}:${password}`).toString('base64');
      headers.Authorization = `Basic ${basic}`;
    }
  } else if (authType === 'apiKey') {
    const keyName = templateIfNeeded(auth?.apiKeyName) || String(credentialRow?.key_name || '') || 'X-API-Key';
    const keyValue = templateIfNeeded(auth?.apiKeyValue) || credentialApiKey || '';
    const keyIn = String(auth?.apiKeyIn || 'header').toLowerCase();
    if (keyValue) {
      if (keyIn === 'query') {
        try {
          const u = new URL(url);
          if (!u.searchParams.has(keyName)) {
            u.searchParams.set(keyName, keyValue);
          }
          url = u.toString();
        } catch {
          const sep = url.includes('?') ? '&' : '?';
          if (!url.includes(`${encodeURIComponent(keyName)}=`) && !url.includes(`${keyName}=`)) {
            url = `${url}${sep}${encodeURIComponent(keyName)}=${encodeURIComponent(keyValue)}`;
          }
        }
      } else if (!(keyName in headers)) {
        headers[keyName] = keyValue;
      }
    }
  }
  let body: any = config?.body;
  const formDataConfig = (config?.formData && typeof config.formData === 'object') ? config.formData : null;
  if (typeof body === 'string' && args && typeof args === 'object') {
    body = applyTemplate(body, args);
  }
  if (!['GET', 'HEAD'].includes(method) && formDataConfig && Object.keys(formDataConfig).length > 0 && config?.bodyMode === 'form-data') {
    const form = new FormData();
    for (const [k, v] of Object.entries(formDataConfig)) {
      const value = typeof v === 'string' ? applyTemplate(v, args || {}) : String(v ?? '');
      form.append(k, value);
    }
    body = form;
    delete headers['Content-Type'];
    delete (headers as any)['content-type'];
  }
  if (body && typeof body === 'object') {
    if (!(body instanceof FormData)) {
      body = JSON.stringify(body);
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    }
  }

  if ((!body || body === '') && args && typeof args === 'object' && !['GET', 'HEAD'].includes(method)) {
    body = JSON.stringify(args);
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
  }

  // For GET/HEAD tools, if URL doesn't explicitly template all args,
  // include missing primitive args as query params by default.
  if (['GET', 'HEAD'].includes(method) && args && typeof args === 'object') {
    try {
      const u = new URL(url);
      for (const [k, v] of Object.entries(args)) {
        if (v == null || u.searchParams.has(k)) continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          u.searchParams.set(k, String(v));
        }
      }
      url = u.toString();
    } catch {
      // If URL parsing fails, keep original URL.
    }
  }

  const res = await fetch(url, {
    method,
    headers,
    body: ['GET', 'HEAD'].includes(method) ? undefined : body
  });

  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!res.ok) {
    return `[HTTP ${res.status}] ${text}`;
  }

  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(text);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

async function runKnowledgeSearch(config: any, args: any): Promise<string> {
  const { indexId, topK = 5, scoreThreshold = 0.0 } = config;
  const { query } = args;

  if (!indexId || !query) {
    return '[Knowledge Search Error] Missing indexId or query in configuration/arguments.';
  }

  try {
    const startTime = Date.now();

    // Generate embedding for the query
    const { generateEmbedding, searchSimilarChunks } = await import('./src/utils/embeddings.js');
    const embeddingConfig = config.embeddingConfig || { provider: 'google', model: 'text-embedding-004' };
    const { embedding } = await generateEmbedding(query, embeddingConfig);

    // Search for similar chunks
    const results = await searchSimilarChunks(embedding, indexId, topK, scoreThreshold);

    const latency = Date.now() - startTime;

    // Record the search in analytics
    const prisma = (await import('./src/platform/prisma.js')).getPrisma();
    await prisma.knowledgebaseSearch.create({
      data: {
        indexId,
        query,
        resultsCount: results.length,
        latencyMs: latency
      }
    });

    if (results.length === 0) {
      return `[Knowledge Search] No relevant information found for query: "${query}"`;
    }

    // Format results
    const formattedResults = results.map((result, i) =>
      `[${i + 1}] ${result.document.name}${result.document.description ? ` - ${result.document.description}` : ''}\n${result.chunk.content}`
    ).join('\n\n');

    return `[Knowledge Search Results for "${query}"]\n\n${formattedResults}`;
  } catch (error: any) {
    console.error('Knowledge search error:', error);
    return `[Knowledge Search Error] ${error.message}`;
  }
}

async function executeTool(toolName: string, args: any, mcpClients?: Map<string, Client>, toolRecord?: any): Promise<string> {
  console.log(`Executing tool ${toolName} with args:`, args);

  if (mcpClients) {
    for (const [prefix, client] of mcpClients.entries()) {
      if (toolName.startsWith(prefix + '_')) {
        const actualToolName = toolName.substring(prefix.length + 1);
        try {
          const result = await client.callTool({
            name: actualToolName,
            arguments: args
          });
          if (result.isError) {
             return `[Error] ${(result.content as any[]).map(c => c.type === 'text' ? c.text : '').join('\n')}`;
          }
          return (result.content as any[]).map(c => c.type === 'text' ? c.text : JSON.stringify(c)).join('\n');
        } catch (e: any) {
          return `[Error executing MCP tool] ${e.message}`;
        }
      }
    }
  }

  const tool = toolRecord || db.prepare('SELECT * FROM tools WHERE name = ?').get(toolName);
  if (!tool) {
    if (toolName.toLowerCase().includes('search')) {
      return `[Mock Search Result] Found information about "${JSON.stringify(args)}". The weather is sunny. The stock price is up.`;
    }
    if (toolName.toLowerCase().includes('calc')) {
      return `[Mock Calculator] Result: 42`;
    }
    return `[Mock Tool Output] Executed ${toolName} successfully.`;
  }

  let config: any = {};
  try {
    config = tool.config ? JSON.parse(tool.config) : {};
  } catch {
    config = {};
  }

  if (tool.type === 'python') {
    const code = String(config?.code || '');
    if (!code.trim()) return '[Python Error] No code provided in tool config.';
    return runPythonTool(code, args);
  }

  if (tool.type === 'http') {
    return runHttpTool(config, args);
  }

  if (tool.type === 'internal') {
    const fnName = String(config?.method || '');
    try {
      if (fnName === 'list_platform_tools') {
        const result = await internalTools.listPlatformTools();
        return JSON.stringify(result, null, 2);
      }
      if (fnName === 'upsert_platform_tool') {
        const result = await internalTools.upsertPlatformTool(args);
        return JSON.stringify(result, null, 2);
      }
      if (fnName === 'deploy_tool_script') {
        const result = await internalTools.deployToolScript(args);
        return JSON.stringify(result, null, 2);
      }
      return `[Internal Error] Unknown internal method: ${fnName}`;
    } catch (e: any) {
      return `[Internal Error] ${e.message}`;
    }
  }

  if (tool.type === 'mcp_stdio_proxy') {
    const command = String(config?.command || '').trim();
    const mcpToolName = String(config?.mcpToolName || '').trim();
    const cmdArgs = Array.isArray(config?.args) ? config.args.map((x: any) => String(x)) : [];
    if (!command || !mcpToolName) {
      return '[MCP Stdio Error] Missing command or mcpToolName in tool config.';
    }
    const timeoutMs = Number(config?.timeoutMs || 45000);
    const envFromConfig = config?.env && typeof config.env === 'object' ? (config.env as Record<string, string>) : {};
    const env = { ...process.env, ...envFromConfig };

    const client = new Client({ name: 'agentic-orchestrator', version: '1.0.0' }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command,
      args: cmdArgs,
      env,
    } as any);
    try {
      await withTimeout(client.connect(transport), timeoutMs, 'MCP stdio connect');
      const result = await withTimeout(client.callTool({ name: mcpToolName, arguments: args }), timeoutMs, 'MCP stdio tool');
      if (result.isError) {
        return `[Error] ${(result.content as any[]).map(c => c.type === 'text' ? c.text : '').join('\n')}`;
      }
      return (result.content as any[]).map(c => c.type === 'text' ? c.text : JSON.stringify(c)).join('\n');
    } catch (e: any) {
      return `[MCP Stdio Error] ${e?.message || String(e)}`;
    } finally {
      try { await client.close(); } catch {}
    }
  }

  if (tool.type === 'search') {
    return `[Mock Search Result] Found information about "${JSON.stringify(args)}". The weather is sunny. The stock price is up.`;
  }

  if (tool.type === 'calculator') {
    return `[Mock Calculator] Result: 42`;
  }

  if (tool.type === 'knowledge_search') {
    return await runKnowledgeSearch(config, args);
  }

  return `[Tool Output] Executed ${tool.name || toolName} successfully.`;
}

async function getProviderConfig(providerIdentifier: string): Promise<{ apiKey?: string, apiBase?: string, providerType: string, source: string, sourceName?: string }> {
  // 1. Check if it's a specific provider name in llm_providers
  const specificProvider = db.prepare('SELECT * FROM llm_providers WHERE name = ?').get(providerIdentifier) as any;
  if (specificProvider) {
      return { 
          apiKey: specificProvider.api_key, 
          apiBase: specificProvider.api_base, 
          providerType: specificProvider.provider,
          source: 'specific_provider',
          sourceName: specificProvider.name
      };
  }

  // 2. Check if it's a provider type (e.g. 'openai') and get the default one
  const defaultProvider = db.prepare('SELECT * FROM llm_providers WHERE provider = ? AND is_default = 1').get(providerIdentifier) as any;
  if (defaultProvider) {
      return { 
          apiKey: defaultProvider.api_key, 
          apiBase: defaultProvider.api_base, 
          providerType: defaultProvider.provider,
          source: 'default_provider',
          sourceName: defaultProvider.name
      };
  }

  // 3. Fallback to legacy credentials table
  const cred = db.prepare('SELECT api_key FROM credentials WHERE provider = ?').get(providerIdentifier) as any;
  if (cred) return { 
      apiKey: cred.api_key, 
      providerType: providerIdentifier,
      source: 'legacy_credential'
  };

  // 4. Fallback to env vars
  let apiKey;
  let envVarName;
  if (providerIdentifier === 'google') { apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY; envVarName = 'GEMINI_API_KEY'; }
  if (providerIdentifier === 'openai') { apiKey = process.env.OPENAI_API_KEY; envVarName = 'OPENAI_API_KEY'; }
  if (providerIdentifier === 'anthropic') { apiKey = process.env.ANTHROPIC_API_KEY; envVarName = 'ANTHROPIC_API_KEY'; }
  
  if (apiKey) {
      return { apiKey, providerType: providerIdentifier, source: 'env_var', sourceName: envVarName };
  }

  return { providerType: providerIdentifier, source: 'missing' };
}

// Prices are USD per 1M tokens.
const DEFAULT_PRICING: Record<string, { input: number; output: number }> = {
  // Google Gemini (Gemini API standard pricing)
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'gemini-2.0-flash-exp': { input: 0.0, output: 0.0 }, // Free during exp period
  'gemini-1.0-pro': { input: 0.50, output: 1.50 },

  // OpenAI (public API pricing)
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'o1': { input: 15.00, output: 60.00 },
  'o1-preview': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 1.10, output: 4.40 },
  'o3': { input: 2.00, output: 8.00 },
  'o3-mini': { input: 1.10, output: 4.40 },
  'o4-mini': { input: 1.10, output: 4.40 },

  // Anthropic Claude
  'claude-3-5-sonnet-20240620': { input: 3.00, output: 15.00 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
};

function normalizeModelKey(model: string): string {
  return String(model || '').trim().toLowerCase();
}

function derivePricingAlias(model: string): string {
  const key = normalizeModelKey(model);
  if (!key) return '';
  if (key.startsWith('gemini-1.5-flash')) return 'gemini-1.5-flash';
  if (key.startsWith('gemini-1.5-pro')) return 'gemini-1.5-pro';
  if (key.startsWith('gemini-2.0-flash')) return 'gemini-2.0-flash-exp';

  if (key.startsWith('gpt-4o-mini')) return 'gpt-4o-mini';
  if (key.startsWith('gpt-4o')) return 'gpt-4o';
  if (key.startsWith('o1-mini')) return 'o1-mini';
  if (key.startsWith('o1')) return 'o1';
  if (key.startsWith('o3-mini')) return 'o3-mini';
  if (key.startsWith('o3')) return 'o3';
  if (key.startsWith('o4-mini')) return 'o4-mini';

  if (key.startsWith('claude-3-5-sonnet')) return 'claude-3-5-sonnet-20241022';
  if (key.startsWith('claude-3-5-haiku')) return 'claude-3-5-haiku-20241022';
  if (key.startsWith('claude-3-opus')) return 'claude-3-opus-20240229';
  if (key.startsWith('claude-3-haiku')) return 'claude-3-haiku-20240307';
  return key;
}

function getModelPricing(model: string): { input: number; output: number } {
  const modelKey = normalizeModelKey(model);
  const alias = derivePricingAlias(modelKey);
  const row = db.prepare('SELECT input_usd, output_usd FROM model_pricing WHERE lower(model) IN (?, ?) LIMIT 1').get(modelKey, alias) as any;
  if (row && Number.isFinite(row.input_usd) && Number.isFinite(row.output_usd)) {
    return { input: Number(row.input_usd), output: Number(row.output_usd) };
  }
  return DEFAULT_PRICING['gemini-1.5-flash'];
}

function getProviderBaselinePricing(providerType: string): { input: number; output: number } {
  const p = String(providerType || '').toLowerCase();
  if (p === 'openai' || p === 'openai-compatible') return DEFAULT_PRICING['gpt-4o-mini'];
  if (p === 'anthropic') return DEFAULT_PRICING['claude-3-5-haiku-20241022'];
  return DEFAULT_PRICING['gemini-1.5-flash'];
}


async function enqueueJob(type: string, payload: any) {
  return await enqueueRuntimeJob(type, payload);
}

async function updateJobResult(jobId: number, status: 'completed' | 'failed' | 'canceled', result?: any, error?: string) {
  await updateRuntimeJobResult(jobId, status, result, error);
}

async function claimNextJob(): Promise<{ id: number; type: string; payload: any } | null> {
  return await claimNextRuntimeJob();
}

async function waitForJob(jobId: number, timeoutMs: number) {
  return await waitForRuntimeJob(jobId, timeoutMs);
}

async function collectExecutionUsage(executionIds: number[]) {
  return await collectRuntimeExecutionUsage(executionIds);
}

async function runDelegatedAgentExecution(options: {
  supervisorAgent: any;
  parentExecutionId: number;
  task: string;
  delegates: Array<{ agentId: number; task: string; title?: string | null }>;
  synthesisAgentId?: number | null;
  synthesize?: boolean;
  sessionId?: string;
  userId?: string;
}) {
  const {
    supervisorAgent,
    parentExecutionId,
    task,
    delegates,
    synthesisAgentId,
    synthesize = true,
    sessionId,
    userId,
  } = options;
  const cancelToken = getCancelToken(agentCancelTokens, parentExecutionId);
  const childExecutionIds: number[] = [];
  let terminalStatus: 'completed' | 'failed' | 'canceled' = 'completed';
  let terminalOutput = '';

  try {
    if (!delegates.length) {
      throw new Error('At least one delegate is required');
    }

    const preparedDelegates = delegates.map((delegate, index) => {
      const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(delegate.agentId) as any;
      if (!agent) {
        throw new Error(`Delegate agent ${delegate.agentId} not found`);
      }
      return {
        agent,
        task: String(delegate.task || '').trim() || task,
        title: String(delegate.title || '').trim() || agent.name || `Delegate ${index + 1}`,
      };
    });

    const delegationRows = await Promise.all(preparedDelegates.map(async (delegate) => {
      const row = await getPrisma().orchestratorAgentDelegation.create({
        data: {
          parentExecutionId,
          agentId: delegate.agent.id,
          role: 'delegate',
          title: delegate.title,
          status: 'queued',
          task: delegate.task,
        },
        select: { id: true },
      });
      return {
        id: row.id,
        agent: delegate.agent,
        task: delegate.task,
        title: delegate.title,
      };
    }));

    for (const delegation of delegationRows) {
      const jobId = await enqueueJob('run_agent', {
        agentId: delegation.agent.id,
        task: delegation.task,
        session_id: sessionId,
        user_id: userId,
        initiatedBy: 'delegated_agent_child',
        parentExecutionId,
        delegationTitle: delegation.title,
      });
      await getPrisma().orchestratorAgentDelegation.update({
        where: { id: delegation.id },
        data: { childJobId: jobId, status: 'queued', updatedAt: new Date() },
      });
    }

    let pending = true;
    while (pending) {
      if (cancelToken.canceled) {
        await cascadeCancelDelegatedChildren(parentExecutionId, cancelToken.reason || 'Delegated execution canceled');
        throw new Error(cancelToken.reason || 'Delegated execution canceled');
      }

      pending = false;
      const rows = await getDelegationRows(parentExecutionId);
      for (const row of rows) {
        if (row.role !== 'delegate') continue;
        const jobId = Number(row.child_job_id || 0);
        if (!jobId) continue;
        const job = await getJobRow(jobId);
        if (!job) {
          await getPrisma().orchestratorAgentDelegation.update({
            where: { id: Number(row.id) },
            data: { status: 'failed', error: 'Child job not found', updatedAt: new Date() },
          });
          continue;
        }
        if (job.status === 'pending' || job.status === 'running') {
          pending = true;
        }
        const parsedResult = parseJsonObject(job.result);
        const childExecId = Number(parsedResult?.exec_id || row.child_execution_id || 0);
        if (childExecId > 0 && !childExecutionIds.includes(childExecId)) {
          childExecutionIds.push(childExecId);
        }
        const nextStatus =
          job.status === 'completed' ? 'completed'
          : job.status === 'failed' ? 'failed'
          : job.status === 'canceled' ? 'canceled'
          : job.status;
        await getPrisma().orchestratorAgentDelegation.update({
          where: { id: Number(row.id) },
          data: {
            childExecutionId: childExecId > 0 ? childExecId : undefined,
            status: nextStatus,
            result: parsedResult?.result != null ? String(parsedResult.result) : undefined,
            error: job.error || undefined,
            updatedAt: new Date(),
          },
        });
      }

      if (pending) await sleep(250);
    }

    const finalDelegations = await getDelegationRows(parentExecutionId);
    const completedDelegates = finalDelegations.filter((row) => row.role === 'delegate' && row.status === 'completed');
    const failedDelegates = finalDelegations.filter((row) => row.role === 'delegate' && row.status !== 'completed');
    const summary = summarizeDelegationResults(finalDelegations.filter((row) => row.role === 'delegate'));

    let finalText = summary || 'No delegate output was produced.';
    let finalStatus: 'completed' | 'failed' | 'canceled' = failedDelegates.length ? 'failed' : 'completed';

    if (cancelToken.canceled) {
      finalStatus = 'canceled';
      finalText = cancelToken.reason || 'Delegated execution canceled';
    } else if (synthesize && completedDelegates.length) {
      const synthesisAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(synthesisAgentId || supervisorAgent.id)) as any;
      if (!synthesisAgent) {
        throw new Error(`Synthesis agent ${synthesisAgentId || supervisorAgent.id} not found`);
      }
      const synthesisTask = [
        `Original user request:\n${task}`,
        'Delegate outputs:',
        summary,
        'Produce a concise final answer that synthesizes the delegate results, resolves conflicts if possible, and notes any important failures.',
      ].join('\n\n');
      const synthesisResult = await runAgent(
        synthesisAgent,
        { description: synthesisTask, expected_output: 'A synthesized answer for the original user request.' },
        '',
        () => undefined,
        { initiatedBy: 'delegated_agent_synthesis', sessionId, userId },
        { parentExecutionId, executionKind: 'delegated_synthesis', delegationTitle: 'Final synthesis' }
      );
      const synthesisExecId = Number(synthesisResult.exec_id || 0);
      if (synthesisExecId > 0) childExecutionIds.push(synthesisExecId);
      await getPrisma().orchestratorAgentDelegation.create({
        data: {
          parentExecutionId,
          childExecutionId: synthesisExecId || null,
          agentId: synthesisAgent.id,
          role: 'synthesis',
          title: synthesisAgent.name || 'Synthesis',
          status: 'completed',
          task: synthesisTask,
          result: synthesisResult.text,
          updatedAt: new Date(),
        },
      });
      finalText = synthesisResult.text;
      finalStatus = failedDelegates.length && !completedDelegates.length ? 'failed' : 'completed';
    } else if (failedDelegates.length && !completedDelegates.length) {
      finalText = summary || failedDelegates.map((row) => `${row.title || row.agent_name}: ${row.error || row.status}`).join('\n');
    }

    terminalStatus = finalStatus;
    terminalOutput = finalText;
    await finalizeSupervisorExecution(parentExecutionId, finalStatus, finalText, await collectExecutionUsage(childExecutionIds));
  } catch (error: any) {
    const message = error?.message || 'Delegated execution failed';
    const canceled = cancelToken.canceled || String(message).toLowerCase().includes('canceled');
    if (canceled) {
      await cascadeCancelDelegatedChildren(parentExecutionId, cancelToken.reason || message);
    }
    terminalStatus = canceled ? 'canceled' : 'failed';
    terminalOutput = message;
    await finalizeSupervisorExecution(parentExecutionId, terminalStatus, message, await collectExecutionUsage(childExecutionIds));
  } finally {
    db.prepare("UPDATE agents SET status = 'idle' WHERE id = ?").run(supervisorAgent.id);
    agentCancelTokens.delete(parentExecutionId);
    delegatedExecutionPromises.delete(parentExecutionId);
  }
  return { parentExecutionId, status: terminalStatus, output: terminalOutput };
}

async function processJob(job: { id: number; type: string; payload: any }) {
  if (job.type === 'run_agent') {
    const { agentId, task, session_id, user_id, initiatedBy, retryOfExecutionId, parentExecutionId, delegationTitle } = job.payload || {};
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;
    if (!agent) throw new Error('Agent not found');
    const taskObj = { description: task, expected_output: 'The best possible answer.' };
    const logs: any[] = [];
    const session = await ensureAgentSession(agent.id, session_id, user_id);
    const result = await runAgent(agent, taskObj, "", (l) => logs.push(l), {
      initiatedBy: initiatedBy || 'queued_agent_run',
      sessionId: session.id,
      userId: session.user_id ?? user_id,
    }, {
      retryOfExecutionId: retryOfExecutionId ?? null,
      parentExecutionId: parentExecutionId ?? null,
      delegationTitle: delegationTitle ?? null,
      executionKind: parentExecutionId ? 'delegated_child' : 'standard',
    });
    return { exec_id: result.exec_id, result: result.text, usage: result.usage, logs, session_id: session.id, user_id: session.user_id ?? user_id ?? null };
  }

  if (job.type === 'run_crew') {
    const { crewId, executionId, initialInput, initiatedBy, retryOfExecutionId } = job.payload || {};
    await runCrewExecution(
      crewId,
      executionId,
      initialInput || "",
      { initiatedBy: initiatedBy || 'queued_crew_run' },
      { retryOfExecutionId: retryOfExecutionId ?? null }
    );
    return { executionId };
  }

  if (job.type === 'run_workflow') {
    const { runId } = job.payload || {};
    const numericRunId = Number(runId);
    if (!Number.isFinite(numericRunId)) throw new Error('Invalid workflow run id');
    await persistWorkflowRun(numericRunId, 'running', null, []);
    return await runWorkflowExecution(numericRunId);
  }

  throw new Error(`Unknown job type: ${job.type}`);
}

function startJobWorker() {
  if (workerTimer) return;
  workerTimer = setInterval(async () => {
    while (workerRunning < JOB_CONCURRENCY) {
      const next = await claimNextJob();
      if (!next) break;
      workerRunning += 1;
      let finalized = false;
      const finalize = async (status: 'completed' | 'failed', result?: any, error?: string) => {
        if (finalized) return;
        finalized = true;
        await updateJobResult(next.id, status, result, error);
        workerRunning -= 1;
      };
      const timeoutHandle = setTimeout(() => {
        void finalize('failed', null, `Job timed out after ${JOB_TIMEOUT_MS}ms`);
      }, JOB_TIMEOUT_MS);
      processJob(next)
        .then((result) => {
          clearTimeout(timeoutHandle);
          return finalize('completed', result);
        })
        .catch((e: any) => {
          clearTimeout(timeoutHandle);
          return finalize('failed', null, e?.message || 'Job failed');
        });
    }
  }, 200);
}

async function recoverStaleExecutionState() {
  const recovered = await recoverRuntimeState();
  const recoveredCrewExecutions = db.prepare(
    "UPDATE crew_executions SET status = 'failed' WHERE status = 'running'"
  ).run();
  if (recovered.jobs || recovered.agentExecutions || recovered.workflowRuns || recoveredCrewExecutions.changes) {
    console.warn(
      `Recovered stale state: jobs=${recovered.jobs}, agent_executions=${recovered.agentExecutions}, crew_executions=${recoveredCrewExecutions.changes}, workflow_runs=${recovered.workflowRuns}`
    );
  }
}

interface RunResult {
    exec_id?: number;
    text: string;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        cost: number;
    };
}

type RunInvocation = { initiatedBy: string; sessionId?: string; userId?: string };
type RunMeta = { retryOfExecutionId?: number | null; parentExecutionId?: number | null; executionKind?: string; delegationTitle?: string | null };

function formatExecutionError(error: any, fallback = 'Execution failed'): string {
  if (!error) return fallback;
  const raw = typeof error?.message === 'string' ? error.message : String(error);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error?.message && typeof parsed.error.message === 'string') {
      return parsed.error.message;
    }
  } catch {
    // ignore parse failures
  }
  return raw;
}

function mergeMaxMetricsTags(existingTags: any, max: { [k: string]: number }) {
  const base = existingTags && typeof existingTags === 'object' ? { ...(existingTags as any) } : {};
  const metrics = base.metrics && typeof base.metrics === 'object' ? { ...(base.metrics as any) } : {};
  const prev = metrics.max && typeof metrics.max === 'object' ? { ...(metrics.max as any) } : {};
  metrics.max = {
    prompt_tokens: Math.max(Number(prev.prompt_tokens || 0), Number(max.prompt_tokens || 0)),
    completion_tokens: Math.max(Number(prev.completion_tokens || 0), Number(max.completion_tokens || 0)),
    total_tokens: Math.max(Number(prev.total_tokens || 0), Number(max.total_tokens || 0)),
    cost_usd: Math.max(Number(prev.cost_usd || 0), Number(max.cost_usd || 0)),
    duration_ms: Math.max(Number(prev.duration_ms || 0), Number(max.duration_ms || 0)),
    input_chars: Math.max(Number(prev.input_chars || 0), Number(max.input_chars || 0)),
    output_chars: Math.max(Number(prev.output_chars || 0), Number(max.output_chars || 0)),
  };
  metrics.updated_at = new Date().toISOString();
  base.metrics = metrics;
  return base;
}

function estimateTokenCount(text: string): number {
  // Conservative approximation when provider usage metadata is unavailable.
  const s = String(text || '');
  if (!s) return 0;
  return Math.max(1, Math.round(s.length / 4));
}

async function runAgent(
  agent: any,
  task: any,
  context: string,
  logCallback: (log: any) => void,
  invocation?: RunInvocation,
  runMeta?: RunMeta
): Promise<RunResult> {
  // Optional: write runs/events into the platform DB (Postgres) using the project owning this API key.
  const platformApiKey = process.env.PLATFORM_PROJECT_API_KEY;
  const mappedPlatformProjectId = getPlatformProjectIdForLocalProject(agent?.project_id ?? null);
  const configuredPlatformProjectId = getSetting(SETTINGS_KEY_PLATFORM_INGEST_PROJECT_ID);
  let platformRunId: string | null = null;
  let platformOrgId: string | null = null;
  let platformProjectId: string | null = null;
  const platformStart = Date.now();
  let platformFinalStatus: 'completed' | 'failed' = 'completed';
  let platformFinalError: any = null;
  let runError: any = null;

  const session = invocation?.sessionId
    ? await ensureAgentSession(agent.id, invocation.sessionId, invocation.userId)
    : undefined;
  const sessionId = session?.id ?? null;
  const sessionUserId = session?.user_id ?? invocation?.userId ?? null;
  const sessionConversation = sessionId ? await loadSessionConversation(sessionId) : [];
  const sessionSummary = sessionId ? await loadSessionSummary(sessionId) : '';
  const memoryContext = buildMemoryContext(sessionSummary, sessionConversation);
  const effectiveContext = [context, memoryContext].filter(Boolean).join('\n\n');
  const toolsEnabled = agent.tools_enabled !== 0 && agent.tools_enabled !== false;
  const systemPrompt = (agent.system_prompt && String(agent.system_prompt).trim())
    ? String(agent.system_prompt).trim()
    : buildSystemPrompt(agent);
  const temperature = normalizeNumber(agent.temperature);
  const maxTokens = normalizeNumber(agent.max_tokens);
  const memoryWindow = normalizeNumber(agent.memory_window) ?? 12;
  const timeoutMs = normalizeNumber(agent.timeout_ms) ?? 0;
  const retryConfig = getRetryConfig(agent.retry_policy);
  const accessOrgId = agent?.project_id ? (() => {
    const mapped = getPlatformProjectIdForLocalProject(agent.project_id);
    return mapped || null;
  })() : null;
  let accessPolicy = getRuntimeAccessPolicy(null);
  if (accessOrgId) {
    try {
      const p = await getPrisma().project.findUnique({ where: { id: accessOrgId }, select: { orgId: true } });
      accessPolicy = getRuntimeAccessPolicy(p?.orgId || null);
    } catch {
      accessPolicy = getRuntimeAccessPolicy(null);
    }
  }
  if (accessPolicy.agents_mode === 'none') {
    throw new Error('Agent execution is disabled by tenant/global access policy.');
  }
  if (accessPolicy.agents_mode === 'allowlist') {
    const allowedAgents = new Set(accessPolicy.allowed_agent_ids);
    if (!allowedAgents.has(Number(agent.id))) {
      throw new Error(`Agent ${agent.id} is not allowed by tenant/global access policy.`);
    }
  }

  try {
    if (platformApiKey) {
      const apiKey = await verifyProjectApiKey(platformApiKey);
      platformOrgId = apiKey.project.orgId;
      platformProjectId = apiKey.projectId;
    } else {
      const desiredProjectId = mappedPlatformProjectId || configuredPlatformProjectId;
      if (!desiredProjectId) {
        platformOrgId = null;
        platformProjectId = null;
      } else {
        const project = await getPrisma().project.findUnique({ where: { id: desiredProjectId } });
        if (project) {
          platformOrgId = project.orgId;
          platformProjectId = project.id;
        }
      }
    }

	    if (platformOrgId && platformProjectId) {
	      platformRunId = uuid();
	      await getPrisma().run.create({
	        data: {
          id: platformRunId,
          orgId: platformOrgId,
          projectId: platformProjectId,
          kind: 'agent_run',
          name: agent.name,
          status: 'running',
          traceId: randomTraceIdHex32(),
          tags: {
            agent: { id: agent.id, name: agent.name, role: agent.role },
            model: agent.model,
            provider: agent.provider,
            session: sessionId ? { id: sessionId, user_id: sessionUserId } : undefined,
            orchestrator: { local_project_id: agent?.project_id ?? null, initiated_by: invocation?.initiatedBy },
            ingest: { source: 'internal', auth_type: 'server' },
	          },
	        },
	      });
	    }
	  } catch {
	    platformRunId = null;
	    platformOrgId = null;
    platformProjectId = null;
  }

	  return tracer.startActiveSpan('runAgent', async (span) => {
	    const rootSpanId = span.spanContext().spanId;
	    span.setAttribute('agent.name', agent.name);
	    span.setAttribute('agent.role', agent.role);
	    span.setAttribute('agent.model', agent.model || 'gemini-1.5-flash');
	    span.setAttribute('task.description', task.description);

	    // Set status to running
	    db.prepare("UPDATE agents SET status = 'running' WHERE id = ?").run(agent.id);

	    if (platformRunId) {
	      try {
	        await getPrisma().runEvent.create({
	          data: {
	            id: uuid(),
	            runId: platformRunId,
	            type: 'span_start',
	            name: 'runAgent',
	            spanId: rootSpanId,
	            attributes: { 'task.description': task.description, 'call.initiated_by': invocation?.initiatedBy ?? 'agent_loop' },
	          },
	        });
	      } catch {
	        // ignore
	      }
	    }

    const totalUsage = { prompt_tokens: 0, completion_tokens: 0, cost: 0 };
    const rawModel = agent?.model || 'gemini-1.5-flash';
    const model = (rawModel === 'gemini-3-flash-preview') ? 'gemini-1.5-flash' : rawModel;
    const modelPricing = getModelPricing(model);

    let finalOutput = "";
    let finalInput = `System: ${systemPrompt}\nTask: ${task.description}\nContext: ${effectiveContext}`;
    const startedAt = Date.now();
    const execId = await createRuntimeAgentExecution({
      agentId: agent.id,
      status: 'running',
      executionKind: runMeta?.executionKind || 'standard',
      parentExecutionId: runMeta?.parentExecutionId ?? null,
      delegationTitle: runMeta?.delegationTitle ?? null,
      input: finalInput,
      output: '',
      task: String(task?.description || ''),
      retryOf: runMeta?.retryOfExecutionId ?? null,
    });
    logCallback({ type: 'status', agent: agent.name, message: 'Execution record created', execution_id: execId });
    const cancelToken = getCancelToken(agentCancelTokens, execId);

    const mcpClients = new Map<string, Client>();
    let mcpToolDescriptions = '';

    const maxMetrics = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cost_usd: 0,
      duration_ms: 0,
      input_chars: 0,
      output_chars: 0,
    };

    try {
        logCallback({ type: 'status', agent: agent.name, message: 'Preparing tools and execution context...' });
        // Fetch agent tools
        const tools = toolsEnabled
          ? db.prepare(`
              SELECT t.* FROM tools t
              JOIN agent_tools at ON t.id = at.tool_id
              WHERE at.agent_id = ?
            `).all(agent.id) as any[]
          : [];
        let scopedTools = tools;
        if (accessPolicy.tools_mode === 'none') {
          scopedTools = [];
        } else if (accessPolicy.tools_mode === 'allowlist') {
          const allowed = new Set(accessPolicy.allowed_tool_ids);
          scopedTools = scopedTools.filter((t) => allowed.has(Number(t.id)));
        }
        if (toolsEnabled) {
          const mcpToken = getSetting(SETTINGS_KEY_MCP_AUTH_TOKEN) || '';
          const localBaseUrl = `http://127.0.0.1:${PORT}`;
          let directMcpTools = db.prepare(`
            SELECT t.id as tool_id, t.name as tool_name, e.exposed_name, e.description as exposed_description
            FROM agent_mcp_tools amt
            JOIN tools t ON t.id = amt.tool_id
            JOIN mcp_exposed_tools e ON e.tool_id = t.id
            WHERE amt.agent_id = ?
          `).all(agent.id) as any[];
          let mcpBundles = db.prepare(`
            SELECT b.id, b.name, b.slug, b.description
            FROM agent_mcp_bundles amb
            JOIN mcp_bundles b ON b.id = amb.bundle_id
            WHERE amb.agent_id = ?
          `).all(agent.id) as any[];

          if (accessPolicy.mcp_mode === 'none') {
            directMcpTools = [];
            mcpBundles = [];
          } else if (accessPolicy.mcp_mode === 'allowlist') {
            const allowedMcpTools = new Set(accessPolicy.allowed_mcp_tool_ids);
            const allowedMcpBundles = new Set(accessPolicy.allowed_mcp_bundle_ids);
            directMcpTools = directMcpTools.filter((t) => allowedMcpTools.has(Number(t.tool_id)));
            mcpBundles = mcpBundles.filter((b) => allowedMcpBundles.has(Number(b.id)));
          }

          for (const mcpTool of directMcpTools) {
            scopedTools.push({
              id: null,
              name: `mcp_tool_${mcpTool.exposed_name}`,
              type: 'mcp',
              description: mcpTool.exposed_description || `MCP tool: ${mcpTool.tool_name}`,
              config: JSON.stringify({
                serverUrl: `${localBaseUrl}/mcp/tool/${encodeURIComponent(String(mcpTool.exposed_name || ''))}`,
                transportType: 'streamable',
                apiKey: mcpToken,
              }),
            });
          }
          for (const bundle of mcpBundles) {
            scopedTools.push({
              id: null,
              name: `mcp_bundle_${bundle.slug}`,
              type: 'mcp',
              description: bundle.description || `MCP bundle: ${bundle.name}`,
              config: JSON.stringify({
                serverUrl: `${localBaseUrl}/mcp/bundle/${encodeURIComponent(String(bundle.slug || ''))}`,
                transportType: 'streamable',
                apiKey: mcpToken,
              }),
            });
          }
        }

        const toolByName = new Map<string, any>();
        const mcpToolByPrefix = new Map<string, any>();
        for (const tool of scopedTools) {
            toolByName.set(tool.name, tool);
        }

        for (const tool of scopedTools) {
            if (tool.type === 'mcp') {
                try {
                    const config = JSON.parse(tool.config);
                    const serverUrl = config.serverUrl || '';
                    const apiKey = config.apiKey || '';
                    const transportType = config.transportType || 'auto';
                    const customHeaders = config.customHeaders || {};

                    if (!serverUrl) {
                        console.warn(`MCP tool ${tool.name} has no serverUrl configured, skipping.`);
                        continue;
                    }
                    if (transportType !== 'sse' && transportType !== 'streamable' && transportType !== 'auto') {
                        console.warn(`MCP tool ${tool.name} uses unsupported transport "${transportType}". Only sse or streamable are supported.`);
                        continue;
                    }

                    const url = new URL(serverUrl);

                    // Build SSEClientTransportOptions with auth if API key is provided
                    const transportOpts: any = {};
                    let headers: Record<string, string> = {};
                    if (customHeaders && typeof customHeaders === 'object') {
                        headers = { ...(customHeaders as Record<string, string>) };
                    }
                    if (apiKey) {
                        if (!headers.Authorization && !(headers as any).authorization) headers.Authorization = `Bearer ${apiKey}`;
                        if (!headers['X-API-Key'] && !(headers as any)['x-api-key']) headers['X-API-Key'] = apiKey;
                    }
                    if (Object.keys(headers).length) {
                        // eventSourceInit = for the SSE GET request (stream initiation)
                        transportOpts.eventSourceInit = { headers };
                        // requestInit = for POST messages sent over the transport
                        transportOpts.requestInit = { headers };
                    }

                    let resolvedTransport = transportType;
                    let transport: any;
                    let client: Client | null = null;
                    const hasMcpPath = serverUrl.endsWith('/mcp') || serverUrl.includes('/mcp?');
                    const hasSsePath = serverUrl.endsWith('/sse') || serverUrl.includes('/sse?');
                    const candidates = transportType === 'auto'
                      ? (hasMcpPath ? ['streamable'] : (hasSsePath ? ['sse'] : ['streamable', 'sse']))
                      : [transportType];

                    let lastErr: any = null;
                    for (const candidate of candidates) {
                        try {
                            transport = candidate === 'streamable'
                                ? new StreamableHTTPClientTransport(url, { requestInit: transportOpts.requestInit })
                                : new SSEClientTransport(url, transportOpts);
                            client = new Client({ name: 'voice-orchestrator', version: '0.3.0' }, { capabilities: {} });
                            await withTimeout(client.connect(transport), 8000, 'MCP connect');
                            resolvedTransport = candidate as any;
                            break;
                        } catch (e: any) {
                            lastErr = e;
                            try { await client?.close(); } catch {}
                            client = null;
                        }
                    }
                    if (!client) throw lastErr || new Error('MCP connect failed');

                    const prefix = tool.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
                    mcpClients.set(prefix, client);
                    mcpToolByPrefix.set(prefix, tool);
                    
                    const mcpTools = await withTimeout(client.listTools(), 8000, 'MCP listTools');
                    for (const mcpTool of mcpTools.tools) {
                        mcpToolDescriptions += `- ${prefix}_${mcpTool.name}: ${compactPromptText(mcpTool.description || 'MCP tool', 110)}\n`;
                    }
                    console.log(`✓ Connected to MCP tool ${tool.name}, found ${mcpTools.tools.length} tools`);

                    if (resolvedTransport !== transportType && tool.id) {
                        try {
                            const nextConfig = { ...config, transportType: resolvedTransport };
                            db.prepare('UPDATE tools SET config = ? WHERE id = ?').run(JSON.stringify(nextConfig), tool.id);
                        } catch {}
                    }
                } catch (e: any) {
                    const detail = e?.code ? ` (HTTP ${e.code})` : '';
                    console.error(`Failed to connect to MCP tool ${tool.name}${detail}:`, e?.message || e);
                }
            }
        }

        const scopedToolDescriptions = scopedTools
          .filter(t => t.type !== 'mcp')
          .map((t: any) => describeToolForPrompt(t))
          .join('\n');
        const toolDescriptions = scopedToolDescriptions + (mcpToolDescriptions ? '\n' + mcpToolDescriptions : '');
        const toolContext = (toolsEnabled && scopedTools.length > 0) ? toolDescriptions : 'No tools are available for this agent.';

        const basePrompt = `
            Your current task is: ${task.description}
            Expected output: ${task.expected_output}

            Here is the context from previous tasks:
            ${effectiveContext}

            You have access to the following tools:
            ${toolContext}

            If you need to use a tool, respond with a JSON object in this format:
            { "tool": "tool_name", "args": { "arg_name": "value" }, "thought": "Why I am using this tool" }

            If you have the final answer, respond with a JSON object in this format:
            { "final_answer": "Your final answer here. This can be a string, or a nested JSON object/array if the expected output is structured.", "thought": "Why this is the final answer" }
        `;

        let iterations = 0;
        const configuredMaxIterations = normalizeNumber(agent.max_iterations);
        const maxIterations = Math.max(1, Math.min(30, configuredMaxIterations ?? 8));
        const scratchpadEntries: string[] = [];
        const toolSignatureCounts = new Map<string, number>();
        const toolResultCache = new Map<string, string>();
        const recentToolResults: Array<{ tool: string; args: any; result: string; createdAt: string }> = [];
        const appendScratchpadEntry = (entry: string) => {
          const compactEntry = compactPromptText(entry, 2200);
          if (!compactEntry) return;
          scratchpadEntries.push(compactEntry);
          if (scratchpadEntries.length > 6) scratchpadEntries.shift();
        };
        
        while (iterations < maxIterations) {
            if (cancelToken.canceled) {
                const err = new Error(cancelToken.reason || 'Execution canceled');
                (err as any).code = 'CANCELED';
                throw err;
            }
            try {
            const providerName = agent.provider || 'google';
            const config = await getProviderConfig(providerName);
            const currentApiKey = config.apiKey;
            const providerType = config.providerType;
            const pricing = (modelPricing.input > 0 || modelPricing.output > 0)
              ? modelPricing
              : getProviderBaselinePricing(providerType);

            if (!currentApiKey) {
                throw new Error(`API Key not found for provider: ${providerName}`);
            }

            logCallback({ type: 'thinking', agent: agent.name, message: `Thinking with ${providerName} (${model})...` });

            let text = "";
            let usage = { input: 0, output: 0 };
            const iterationContext = [
              basePrompt,
              scratchpadEntries.length ? `Working scratchpad:\n${scratchpadEntries.join('\n\n')}` : '',
            ].filter(Boolean).join('\n\n');

            // Create a child span for the LLM call
            let llmDurationMs = 0;
            const llmStart = Date.now();
            let llmSpanId: string | null = null;
            await tracer.startActiveSpan('llm_call', async (llmSpan) => {
                llmSpanId = llmSpan.spanContext().spanId;
                llmSpan.setAttribute('llm.provider', providerType);
                llmSpan.setAttribute('llm.model', model);
                try {
                    if (providerType === 'openai' || providerType === 'openai-compatible') {
                        const openai = new OpenAI({ 
                            apiKey: currentApiKey,
                            baseURL: config.apiBase // Optional base URL
                        });
                        const completion = await withRetry(() => withTimeout(openai.chat.completions.create({
                            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: iterationContext }],
                            model: model,
                            response_format: { type: "json_object" },
                            temperature: temperature ?? undefined,
                            max_tokens: maxTokens ?? undefined,
                        }), timeoutMs, 'OpenAI request'), retryConfig.maxRetries, retryConfig.baseDelayMs);
                        text = completion.choices[0].message.content || "{}";
                        usage.input = Number(
                          completion.usage?.prompt_tokens ??
                          (completion as any).usage?.input_tokens ??
                          0
                        );
                        usage.output = Number(
                          completion.usage?.completion_tokens ??
                          (completion as any).usage?.output_tokens ??
                          0
                        );

                    } else if (providerType === 'anthropic') {
                        const anthropic = new Anthropic({ 
                            apiKey: currentApiKey,
                            baseURL: config.apiBase
                        });
                        const msg = await withRetry(() => withTimeout(anthropic.messages.create({
                            model: model,
                            max_tokens: maxTokens ?? 1024,
                            temperature: temperature ?? undefined,
                            system: systemPrompt,
                            messages: [{ role: "user", content: iterationContext }]
                        }), timeoutMs, 'Anthropic request'), retryConfig.maxRetries, retryConfig.baseDelayMs);
                        if (msg.content[0].type === 'text') {
                            text = msg.content[0].text;
                        }
                        usage.input = Number((msg as any).usage?.input_tokens ?? 0);
                        usage.output = Number((msg as any).usage?.output_tokens ?? 0);

                    } else {
                        // Default to Google
                        const ai = new GoogleGenAI({ apiKey: currentApiKey });
                        const response = await withRetry(() => withTimeout(ai.models.generateContent({
                            model: model,
                            contents: `${systemPrompt}\n\n${iterationContext}`,
                            config: {
                              responseMimeType: 'application/json',
                              temperature: temperature ?? undefined,
                              maxOutputTokens: maxTokens ?? undefined,
                            }
                        }), timeoutMs, 'Google request'), retryConfig.maxRetries, retryConfig.baseDelayMs);
                        text = response.text;
                        usage.input = Number((response as any).usageMetadata?.promptTokenCount ?? 0);
                        usage.output = Number((response as any).usageMetadata?.candidatesTokenCount ?? 0);
                    }

                    if (!Number.isFinite(usage.input) || usage.input < 0) usage.input = 0;
                    if (!Number.isFinite(usage.output) || usage.output < 0) usage.output = 0;
                    if (usage.input === 0) {
                      usage.input = estimateTokenCount(`${systemPrompt}\n${iterationContext}`);
                    }
                    if (usage.output === 0) {
                      usage.output = estimateTokenCount(text);
                    }
                    
                    llmSpan.setAttribute('llm.usage.prompt_tokens', usage.input);
                    llmSpan.setAttribute('llm.usage.completion_tokens', usage.output);
                    llmSpan.setAttribute('llm.usage.total_tokens', usage.input + usage.output);

                    llmSpan.setStatus({ code: SpanStatusCode.OK });
                } catch (e: any) {
                    llmSpan.recordException(e);
                    llmSpan.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
                    throw e;
                } finally {
                    llmDurationMs = Date.now() - llmStart;
                    llmSpan.end();
                }
            });

            if (platformRunId) {
              try {
                const llmOutputText = typeof text === 'string' ? text : (text == null ? '' : JSON.stringify(text));
                await getPrisma().runEvent.create({
                  data: {
                    id: uuid(),
                    runId: platformRunId,
                    type: 'llm_call',
                    name: 'llm_call',
                    spanId: llmSpanId || undefined,
                    parentSpanId: rootSpanId,
                    durationMs: llmDurationMs,
                    inputText: iterationContext,
                    outputText: llmOutputText,
                    attributes: {
                      'llm.model': model,
                      'llm.provider': providerType,
                      'llm.prompt_tokens': usage.input,
                      'llm.completion_tokens': usage.output,
                      'llm.cost_usd': (usage.input / 1000000 * pricing.input) + (usage.output / 1000000 * pricing.output),
                      'call.initiated_by': invocation?.initiatedBy ?? 'agent_loop',
                      'call.kind': 'llm',
                    },
                  },
                });
              } catch {
                // ignore platform ingest failures
              }
            }

            maxMetrics.prompt_tokens = Math.max(maxMetrics.prompt_tokens, usage.input);
            maxMetrics.completion_tokens = Math.max(maxMetrics.completion_tokens, usage.output);
            maxMetrics.total_tokens = Math.max(maxMetrics.total_tokens, usage.input + usage.output);
            maxMetrics.cost_usd = Math.max(maxMetrics.cost_usd, (usage.input / 1000000 * pricing.input) + (usage.output / 1000000 * pricing.output));
            maxMetrics.duration_ms = Math.max(maxMetrics.duration_ms, llmDurationMs);
            maxMetrics.input_chars = Math.max(maxMetrics.input_chars, iterationContext.length);
            maxMetrics.output_chars = Math.max(maxMetrics.output_chars, typeof text === 'string' ? text.length : 0);
            
            // Accumulate usage
            totalUsage.prompt_tokens += usage.input;
            totalUsage.completion_tokens += usage.output;
            totalUsage.cost += (usage.input / 1000000 * pricing.input) + (usage.output / 1000000 * pricing.output);

            let action;
            try {
                const jsonString = text.replace(/```json\n?|\n?```/g, "").trim();
                action = JSON.parse(jsonString);
            } catch (e) {
                try {
                    const jsonString = text.replace(/```json\n?|\n?```/g, "").trim();
                    action = JSON5.parse(jsonString);
                } catch (e2) {
                    // Fallback using regex to extract final_answer and thought
                    const finalAnswerMatch = text.match(/"final_answer"\s*:\s*([\s\S]*?)(?:,\s*"thought"\s*:|\}$)/);
                    if (finalAnswerMatch) {
                        let extractedAnswer = finalAnswerMatch[1].trim();
                        // If it's a string, try to unescape it
                        if (extractedAnswer.startsWith('"') && extractedAnswer.endsWith('"')) {
                            extractedAnswer = extractedAnswer.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                        }
                        
                        const thoughtMatch = text.match(/"thought"\s*:\s*"([^"]*)"/);
                        const thought = thoughtMatch ? thoughtMatch[1] : "Extracted via fallback regex";
                        
                        action = { final_answer: extractedAnswer, thought };
                    } else {
                        logCallback({ type: 'error', agent: agent.name, message: 'Failed to parse JSON response: ' + text });
                        span.recordException(e as Error);

                        finalOutput = text;
                        return { exec_id: execId, text, usage: totalUsage }; 
                    }
                }
            }

            if (action.final_answer) {
                logCallback({ type: 'thought', agent: agent.name, message: action.thought || "Providing final answer" });
                span.setStatus({ code: SpanStatusCode.OK });
                const finalAnswerText = typeof action.final_answer === 'string' ? action.final_answer : JSON.stringify(action.final_answer, null, 2);

                finalOutput = finalAnswerText;
                return { exec_id: execId, text: finalAnswerText, usage: totalUsage };
            }

            if (action.tool) {
                logCallback({ type: 'thought', agent: agent.name, message: action.thought });
                logCallback({ type: 'tool_call', agent: agent.name, tool: action.tool, args: action.args });

                if (!toolsEnabled) {
                    const disabledMsg = 'Tools are disabled for this agent. Continue without tools.';
                    logCallback({ type: 'error', agent: agent.name, message: disabledMsg });
                    appendScratchpadEntry(`[System]\n${disabledMsg}`);
                    iterations++;
                    continue;
                }

                const normalizedArgs = action.args && typeof action.args === 'object' ? action.args : {};
                const signature = `${String(action.tool)}::${JSON.stringify(normalizedArgs, Object.keys(normalizedArgs).sort())}`;
                const signatureCount = (toolSignatureCounts.get(signature) || 0) + 1;
                toolSignatureCounts.set(signature, signatureCount);
                const cachedToolResult = toolResultCache.get(signature);
                if (cachedToolResult != null) {
                    const cacheMsg = `Reused cached result for duplicate tool call "${String(action.tool)}" with same args.`;
                    logCallback({ type: 'warning', agent: agent.name, message: cacheMsg });
                    logCallback({ type: 'tool_result', agent: agent.name, tool: action.tool, result: cachedToolResult });
                    recentToolResults.push({
                      tool: String(action.tool),
                      args: action.args ?? {},
                      result: String(cachedToolResult || ''),
                      createdAt: new Date().toISOString(),
                    });
                    if (recentToolResults.length > 10) recentToolResults.shift();
                    appendScratchpadEntry([
                      '[Tool Execution]',
                      `Tool: ${action.tool}`,
                      `Args: ${summarizeToolArgsForPrompt(action.args)}`,
                      `Result: ${summarizeToolResultForPrompt(cachedToolResult)}`,
                      'Note: Cached result reused for identical args. Continue toward the goal.',
                    ].join('\n'));
                    iterations++;
                    continue;
                }
                if (signatureCount >= 3) {
                    const lastResult = recentToolResults.length ? recentToolResults[recentToolResults.length - 1] : null;
                    const loopMsg = `The same tool call "${String(action.tool)}" with identical args has been attempted ${signatureCount} times. Stop calling it again and provide a final_answer now.`;
                    logCallback({ type: 'warning', agent: agent.name, message: loopMsg });
                    appendScratchpadEntry([
                      '[System]',
                      loopMsg,
                      'Use the latest available tool result below to complete the task:',
                      lastResult
                        ? `Tool: ${lastResult.tool}\nArgs: ${summarizeToolArgsForPrompt(lastResult.args)}\nResult: ${summarizeToolResultForPrompt(lastResult.result)}`
                        : 'No prior tool result recorded.',
                    ].join('\n'));
                    iterations++;
                    continue;
                }
                
                // Create a child span for tool execution
                const toolStart = Date.now();
                const mcpPrefix = Array.from(mcpClients.keys()).find((p) => action.tool?.startsWith(p + '_')) || null;
                const toolKind = mcpPrefix ? 'mcp' : 'local';
                const actualToolName = mcpPrefix ? String(action.tool).substring(mcpPrefix.length + 1) : action.tool;
                const toolRecord = mcpPrefix ? mcpToolByPrefix.get(mcpPrefix) : toolByName.get(action.tool);
                const toolType = mcpPrefix ? 'mcp' : (toolRecord?.type || 'custom');
                let toolSpanId: string | null = null;

                const toolExecId = await createRuntimeToolExecution({
                  toolId: toolRecord?.id ?? null,
                  agentId: agent.id,
                  agentExecutionId: execId,
                  toolName: String(action.tool),
                  toolType,
                  args: action.args ? JSON.stringify(action.args) : null,
                });

                if (cancelToken.canceled) {
                    const err = new Error(cancelToken.reason || 'Execution canceled');
                    (err as any).code = 'CANCELED';
                    throw err;
                }

                let toolResult = '';
                let toolError: any = null;
                try {
                    toolResult = await tracer.startActiveSpan('tool_execution', async (toolSpan) => {
                        toolSpanId = toolSpan.spanContext().spanId;
                        toolSpan.setAttribute('tool.name', action.tool);
                        toolSpan.setAttribute('tool.args', JSON.stringify(action.args));
                        toolSpan.setAttribute('tool.kind', toolKind);
                        try {
                            const res = await executeTool(action.tool, action.args, mcpClients, toolRecord);
                            toolSpan.setStatus({ code: SpanStatusCode.OK });
                            return res;
                        } catch (e: any) {
                            toolSpan.recordException(e);
                            toolSpan.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
                            throw e;
                        } finally {
                            toolSpan.end();
                        }
                    });
                } catch (e: any) {
                    toolError = e;
                }
                const toolDurationMs = Date.now() - toolStart;

                await updateRuntimeToolExecution(toolExecId, {
                  status: toolError ? 'failed' : 'completed',
                  result: toolResult || null,
                  error: toolError ? (toolError.message || String(toolError)) : null,
                  durationMs: toolDurationMs,
                });

                if (toolError) {
                    throw toolError;
                }

                if (platformRunId) {
                  try {
                    await getPrisma().runEvent.createMany({
                      data: [
                        {
                          id: uuid(),
                          runId: platformRunId,
                          type: 'tool_call',
                          name: action.tool,
                          spanId: toolSpanId || undefined,
                          parentSpanId: rootSpanId,
                          attributes: {
                            'tool.name': action.tool,
                            'tool.kind': toolKind,
                            'mcp.prefix': mcpPrefix,
                            'mcp.tool': actualToolName,
                            args: action.args,
                            'call.initiated_by': invocation?.initiatedBy ?? 'agent_loop',
                            'call.kind': 'tool',
                          },
                        },
                        {
                          id: uuid(),
                          runId: platformRunId,
                          type: 'tool_result',
                          name: action.tool,
                          spanId: toolSpanId || undefined,
                          parentSpanId: rootSpanId,
                          durationMs: toolDurationMs,
                          outputText: toolResult,
                          attributes: {
                            'tool.name': action.tool,
                            'tool.kind': toolKind,
                            'mcp.prefix': mcpPrefix,
                            'mcp.tool': actualToolName,
                          },
                        },
                      ],
                      skipDuplicates: true,
                    });
                  } catch {
                    // ignore
                  }
                }

                maxMetrics.duration_ms = Math.max(maxMetrics.duration_ms, toolDurationMs);
                maxMetrics.input_chars = Math.max(maxMetrics.input_chars, JSON.stringify(action.args || {}).length);
                maxMetrics.output_chars = Math.max(maxMetrics.output_chars, String(toolResult || '').length);
                
                logCallback({ type: 'tool_result', agent: agent.name, tool: action.tool, result: toolResult });
                toolResultCache.set(signature, String(toolResult || ''));
                recentToolResults.push({
                  tool: String(action.tool),
                  args: action.args ?? {},
                  result: String(toolResult || ''),
                  createdAt: new Date().toISOString(),
                });
                if (recentToolResults.length > 10) recentToolResults.shift();
                
                appendScratchpadEntry([
                  '[Tool Execution]',
                  `Tool: ${action.tool}`,
                  `Args: ${summarizeToolArgsForPrompt(action.args)}`,
                  `Result: ${summarizeToolResultForPrompt(toolResult)}`,
                  'Continue toward the goal.',
                ].join('\n'));
            } else {
                span.setStatus({ code: SpanStatusCode.OK });

                finalOutput = text;
                return { exec_id: execId, text, usage: totalUsage };
            }

            } catch (error: any) {
            console.error("Error running agent:", error);
            logCallback({ type: 'error', agent: agent.name, message: error.message });
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
            platformFinalStatus = 'failed';
            platformFinalError = { message: error.message, name: error.name, stack: error.stack };
            runError = error;
            throw error;
            }
            iterations++;
        }
        span.setStatus({ code: SpanStatusCode.OK, message: "Max iterations reached" });

        if (recentToolResults.length > 0) {
          const latest = recentToolResults[recentToolResults.length - 1];
          finalOutput = `The agent stopped after ${maxIterations} reasoning steps without a formal final_answer. Latest tool output:\n\nTool: ${latest.tool}\nArgs: ${JSON.stringify(latest.args)}\nResult: ${latest.result}\n\nTip: refine the task prompt or tighten tool instructions to avoid repeated tool loops.`;
        } else {
          finalOutput = "The agent stopped after reaching the iteration limit without returning a final answer.";
        }
        return { exec_id: execId, text: finalOutput, usage: totalUsage };
    } finally {
        // Log execution stats
        const wasCanceled = runError && (runError as any).code === 'CANCELED';
        const currentExec = await getRuntimeAgentExecution(execId);
        const dbAlreadyCanceled = currentExec?.status === 'canceled';
        const finalStatus = (wasCanceled || dbAlreadyCanceled) ? 'canceled' : (runError ? 'failed' : 'completed');
        if ((finalStatus === 'failed' || finalStatus === 'canceled') && !String(finalOutput || '').trim()) {
          finalOutput = finalStatus === 'canceled'
            ? String((runError as any)?.reason || (runError as any)?.message || 'Execution canceled')
            : formatExecutionError(runError, 'Execution failed');
        }
        await updateRuntimeAgentExecution(execId, {
          status: finalStatus,
          promptTokens: totalUsage.prompt_tokens,
          completionTokens: totalUsage.completion_tokens,
          totalCost: totalUsage.cost,
          input: finalInput,
          output: finalOutput,
          task: String(task?.description || ''),
        });

        if (sessionId) {
          const nowIso = new Date().toISOString();
          const messages = Array.isArray(sessionConversation) ? [...sessionConversation] : [];
          messages.push({ role: 'user', content: String(task.description), ts: nowIso });
          const assistantText = finalOutput || runError?.message || 'Error';
          messages.push({ role: 'assistant', content: String(assistantText), ts: nowIso });
          const effectiveWindow = Math.max(2, Number(memoryWindow) || 12);
          const overflowCount = Math.max(0, messages.length - effectiveWindow);
          const overflow = overflowCount > 0 ? messages.slice(0, overflowCount) : [];
          const trimmed = messages.slice(-effectiveWindow);
          const nextSummary = overflow.length ? mergeConversationSummary(sessionSummary, overflow) : sessionSummary;
          await saveSessionSummary(sessionId, nextSummary);
          await saveSessionConversation(sessionId, trimmed);
        }

        for (const client of mcpClients.values()) {
            try {
                await client.close();
            } catch (e) {
                console.error("Error closing MCP client:", e);
            }
        }
        // Set status back to idle
        db.prepare("UPDATE agents SET status = 'idle' WHERE id = ?").run(agent.id);
        
        agentCancelTokens.delete(execId);

        span.setAttribute('agent.usage.prompt_tokens', totalUsage.prompt_tokens);
        span.setAttribute('agent.usage.completion_tokens', totalUsage.completion_tokens);
        span.setAttribute('agent.usage.cost', totalUsage.cost);

        span.end();

        if (platformRunId) {
          try {
            const durationMs = Date.now() - platformStart;
            const existing = await getPrisma().run.findUnique({ where: { id: platformRunId }, select: { tags: true } });
            const existingTags = existing?.tags && typeof existing.tags === 'object' ? existing.tags : {};
            const ensuredTags = {
              ...(existingTags as any),
              agent: (existingTags as any)?.agent ?? { id: agent.id, name: agent.name, role: agent.role },
              model: (existingTags as any)?.model ?? agent.model,
              provider: (existingTags as any)?.provider ?? agent.provider,
              orchestrator: {
                ...(((existingTags as any)?.orchestrator && typeof (existingTags as any).orchestrator === 'object') ? (existingTags as any).orchestrator : {}),
                local_project_id: agent?.project_id ?? null,
                initiated_by: invocation?.initiatedBy,
              },
              ingest: {
                ...(((existingTags as any)?.ingest && typeof (existingTags as any).ingest === 'object') ? (existingTags as any).ingest : {}),
                source: 'internal',
                auth_type: 'server',
              },
            };
            await getPrisma().run.update({
              where: { id: platformRunId },
              data: {
                status: platformFinalStatus,
                endedAt: new Date(),
                durationMs,
                promptTokens: totalUsage.prompt_tokens,
                completionTokens: totalUsage.completion_tokens,
                totalCostUsd: totalUsage.cost,
                error: platformFinalError,
                tags: mergeMaxMetricsTags(ensuredTags, maxMetrics),
              },
            });
            await getPrisma().runEvent.create({
              data: {
                id: uuid(),
                runId: platformRunId,
                type: 'span_end',
                name: 'runAgent',
                spanId: rootSpanId,
                status: platformFinalStatus,
                durationMs,
              },
            });
          } catch {
            // ignore
          }
        }
    }
  });
}

async function runCrewExecution(
  crewId: number | bigint,
  executionId: number | bigint,
  initialInput: string = "",
  invocation?: RunInvocation,
  runMeta?: { retryOfExecutionId?: number | null }
) {
    return tracer.startActiveSpan('runCrewExecution', async (span) => {
        span.setAttribute('crew.id', crewId.toString());
        span.setAttribute('execution.id', executionId.toString());
        const cancelToken = getCancelToken(crewCancelTokens, Number(executionId));

        try {
            const crewRow = db.prepare('SELECT process, max_runtime_ms, max_cost_usd, max_tool_calls, coordinator_agent_id FROM crews WHERE id = ?').get(crewId) as any;
            const process = crewRow?.process || 'sequential';
            let tasks = db.prepare('SELECT * FROM tasks WHERE crew_id = ? ORDER BY id ASC').all(crewId) as any[];
            let generatedRuntimeTasks = 0;
            if (!tasks.length) {
                const crewAgents = db.prepare(`
                  SELECT a.id, a.name, a.role
                  FROM agents a
                  JOIN crew_agents ca ON ca.agent_id = a.id
                  WHERE ca.crew_id = ?
                  ORDER BY ca.id ASC
                `).all(crewId) as any[];
                tasks = crewAgents.map((a, idx) => ({
                  id: -1 * (idx + 1),
                  crew_id: Number(crewId),
                  agent_id: a.id,
                  description: `Collaborate on the crew objective as ${a.role || 'specialist'}${initialInput ? ` using this initial input: ${initialInput}` : ''}.`,
                  expected_output: `Actionable contribution from ${a.name}`,
                }));
                generatedRuntimeTasks = tasks.length;
            }
            let context = initialInput ? `Initial Input Context:\n${initialInput}\n\n` : "";
            let lastOutput = "";
            let plannerInputs: string[] | null = null;
            let plannerAgentForHierarchy: any | null = null;
            const taskOutputs: Array<{ agentName: string; agentRole: string; task: string; output: string }> = [];
            const startedAt = Date.now();
            const maxRuntimeMs = normalizeNumber(crewRow?.max_runtime_ms);
            const maxCostUsd = normalizeNumber(crewRow?.max_cost_usd);
            const maxToolCalls = normalizeNumber(crewRow?.max_tool_calls);
            
            // Helper to append logs safely
            const appendLog = (logItem: any) => {
                const payload = { ...logItem };
                db.prepare('INSERT INTO crew_execution_logs (execution_id, type, payload) VALUES (?, ?, ?)')
                  .run(executionId, String(logItem.type || 'log'), JSON.stringify(payload));
            };
            if (generatedRuntimeTasks > 0) {
                appendLog({
                  type: 'thought',
                  agent: 'system',
                  message: `No explicit tasks found. Generated ${generatedRuntimeTasks} runtime task(s) from assigned crew agents.`,
                });
            }

            let executionPromptTokens = 0;
            let executionCompletionTokens = 0;
            let executionCost = 0;
            let executionToolCalls = 0;

            if (process === 'hierarchical' && tasks.length > 0) {
                const explicitCoordinator = crewRow?.coordinator_agent_id
                  ? ((db.prepare('SELECT * FROM agents WHERE id = ?').get(crewRow.coordinator_agent_id) as any) || null)
                  : null;
                const coordinatorAgent =
                  explicitCoordinator ||
                  ((db.prepare('SELECT * FROM agents WHERE id = ?').get(tasks[0]?.agent_id) as any) || null);

                if (!coordinatorAgent) {
                  throw new Error('Hierarchical crew requires a valid coordinator agent');
                }

                const delegateTasks = tasks
                  .filter((task: any, idx: number) => {
                    const isCoordinatorPlanningTask =
                      idx === 0 &&
                      Number(task.agent_id) === Number(coordinatorAgent.id) &&
                      /plan and coordinate/i.test(String(task.description || ''));
                    return !isCoordinatorPlanningTask;
                  })
                  .map((task: any, idx: number) => {
                    const delegateAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(task.agent_id) as any;
                    if (!delegateAgent) return null;
                    const taskDescription = [
                      String(task.description || `Delegated task ${idx + 1}`),
                      initialInput ? `Original Objective:\n${initialInput}` : '',
                      `Expected Output:\n${String(task.expected_output || 'Completed task output')}`,
                      `Crew Context (JSON):\n${JSON.stringify({
                        process,
                        crew_id: Number(crewId),
                        execution_id: Number(executionId),
                        step: idx + 1,
                        total_steps: tasks.length,
                        coordinator_agent_id: Number(coordinatorAgent.id),
                      }, null, 2)}`,
                    ].filter(Boolean).join('\n\n');
                    return {
                      agentId: Number(delegateAgent.id),
                      title: `${delegateAgent.name} - Crew Step ${idx + 1}`,
                      task: taskDescription,
                    };
                  })
                  .filter(Boolean) as Array<{ agentId: number; title: string; task: string }>;

                appendLog({
                  type: 'thought',
                  agent: coordinatorAgent.name,
                  message: `Launching delegation-native hierarchical crew with ${delegateTasks.length} delegate task(s).`,
                });

                const { parentExecutionId, workflow } = await startDelegatedExecution({
                  supervisorAgent: coordinatorAgent,
                  task: initialInput || `Coordinate crew ${crewId} objective`,
                  delegates: delegateTasks.length ? delegateTasks : [{
                    agentId: Number(coordinatorAgent.id),
                    title: `${coordinatorAgent.name} - Direct coordination`,
                    task: initialInput || `Coordinate crew ${crewId} objective`,
                  }],
                  synthesisAgentId: Number(coordinatorAgent.id),
                  synthesize: true,
                  source: 'crew_hierarchical',
                });

                appendLog({
                  type: 'delegated_parent',
                  agent: coordinatorAgent.name,
                  execution_id: parentExecutionId,
                  delegate_count: delegateTasks.length,
                  message: `Coordinator launched delegated execution tree #${parentExecutionId}.`,
                });

                while (true) {
                  if (cancelToken.canceled) {
                    const parentToken = getCancelToken(agentCancelTokens, parentExecutionId);
                    parentToken.canceled = true;
                    parentToken.reason = cancelToken.reason || 'Crew execution canceled';
                    await updateRuntimeAgentExecution(parentExecutionId, { status: 'canceled' });
                    await cascadeCancelDelegatedChildren(parentExecutionId, parentToken.reason);
                    break;
                  }
                  const parentExec = await getRuntimeAgentExecution(parentExecutionId);
                  if (!parentExec || parentExec.status !== 'running') break;
                  await sleep(250);
                }

                await workflow;

                const parentExec = await getRuntimeAgentExecution(parentExecutionId);
                const delegationRows = await getDelegationRows(parentExecutionId);
                executionPromptTokens = Number(parentExec?.prompt_tokens || 0);
                executionCompletionTokens = Number(parentExec?.completion_tokens || 0);
                executionCost = Number(parentExec?.total_cost || 0);

                for (const delegation of delegationRows) {
                  appendLog({
                    type: delegation.role === 'synthesis' ? 'crew_synthesis_step' : 'crew_delegate',
                    agent: delegation.agent_name || `Agent ${delegation.agent_id}`,
                    title: delegation.title,
                    status: delegation.status,
                    child_execution_id: delegation.child_execution_id || null,
                    task: delegation.task || '',
                    result: delegation.result || '',
                    error: delegation.error || null,
                  });
                }

                const finalCrewResult = String(parentExec?.output || '').trim();
                appendLog({
                  type: 'crew_result',
                  process,
                  delegated_parent_execution_id: parentExecutionId,
                  result: finalCrewResult || 'No final output returned from coordinator.',
                  total_steps: delegationRows.filter((row) => row.role === 'delegate').length,
                });

                db.prepare('UPDATE crew_executions SET prompt_tokens = ?, completion_tokens = ?, total_cost = ? WHERE id = ?')
                  .run(executionPromptTokens, executionCompletionTokens, executionCost, executionId);

                const delegatedStatus = String(parentExec?.status || 'completed');
                db.prepare('UPDATE crew_executions SET status = ? WHERE id = ?').run(
                  delegatedStatus === 'failed' ? 'failed' : delegatedStatus === 'canceled' ? 'canceled' : 'completed',
                  executionId
                );
                span.setStatus({ code: SpanStatusCode.OK });
                return;
            }

            if (process === 'hierarchical' && tasks.length > 0) {
                const agentIds = Array.from(new Set([
                  ...tasks.map((t: any) => t.agent_id),
                  crewRow?.coordinator_agent_id ?? null,
                ].filter((id: any) => id != null)));
                const plannerCandidates = agentIds.length
                  ? (db.prepare(`SELECT * FROM agents WHERE id IN (${agentIds.map(() => '?').join(',')})`).all(...agentIds) as any[])
                  : [];
                const explicitCoordinator = crewRow?.coordinator_agent_id
                  ? ((db.prepare('SELECT * FROM agents WHERE id = ?').get(crewRow.coordinator_agent_id) as any) || null)
                  : null;
                const plannerAgent =
                  (explicitCoordinator && plannerCandidates.some((a: any) => Number(a.id) === Number(explicitCoordinator.id)))
                    ? explicitCoordinator
                    : (
                        plannerCandidates.find((a) => String(a.role || '').toLowerCase().includes('planner') || String(a.name || '').toLowerCase().includes('planner')) ||
                        plannerCandidates[0]
                      );
                plannerAgentForHierarchy = plannerAgent || null;

                if (plannerAgent) {
                    const planTask = {
                        description: `Create a task-by-task plan for the following objective and tasks.\nObjective:\n${initialInput || 'N/A'}\n\nTasks:\n${tasks.map((t: any, i: number) => `${i + 1}. ${t.description}`).join('\n')}\n\nReturn JSON: {"plan":["input for task 1","input for task 2",...]} (length must match tasks).`,
                        expected_output: 'JSON object with plan array.',
                    };

                    const plannerResult = await runAgent(plannerAgent, planTask, "", appendLog, invocation ?? { initiatedBy: 'crew_planner' });
                    try {
                        const parsed = JSON.parse(plannerResult.text);
                        if (Array.isArray(parsed?.plan) && parsed.plan.length === tasks.length) {
                            plannerInputs = parsed.plan.map((p: any) => String(p));
                            appendLog({ type: 'planner_handoff', plan: plannerInputs });
                        }
                    } catch {
                        // ignore planner parsing issues
                    }
                }
            }

            for (let i = 0; i < tasks.length; i++) {
                if (maxRuntimeMs && (Date.now() - startedAt) > maxRuntimeMs) {
                    cancelToken.canceled = true;
                    cancelToken.reason = `Guardrail: max runtime ${maxRuntimeMs}ms exceeded`;
                }
                if (cancelToken.canceled) {
                    db.prepare('UPDATE crew_executions SET status = ? WHERE id = ?').run('canceled', executionId);
                    appendLog({ type: 'canceled', message: cancelToken.reason || 'Execution canceled' });
                    span.setStatus({ code: SpanStatusCode.OK, message: 'canceled' });
                    return;
                }
                const task = tasks[i];
                const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(task.agent_id) as any;
                if (!agent) {
                    throw new Error(`Agent not found for task ${task?.id ?? i + 1}`);
                }
                
                appendLog({ type: 'start', agent: agent.name, task: task.description });

                const recentOutputsText = taskOutputs
                  .slice(-2)
                  .map((entry, idx) => `#${taskOutputs.length - 1 + idx}\nAgent: ${entry.agentName} (${entry.agentRole})\nTask: ${entry.task}\nOutput:\n${entry.output}`)
                  .join('\n\n');
                const handoffContext =
                  process === 'sequential'
                    ? (lastOutput ? `Previous agent output:\n${lastOutput}\n` : context)
                    : `${context}${lastOutput ? `\n[Handoff]\nPrevious agent output:\n${lastOutput}\n` : ''}${recentOutputsText ? `\nRecent Upstream Outputs:\n${recentOutputsText}\n` : ''}`;

                const taskDescriptionParts: string[] = [String(task.description || '')];
                const planned = plannerInputs && plannerInputs[i] ? String(plannerInputs[i]) : '';
                if (i === 0 && initialInput) {
                    taskDescriptionParts.push(`User Input:\n${initialInput}`);
                }
                if (planned) {
                    taskDescriptionParts.push(`Planner Input:\n${planned}`);
                } else if (lastOutput) {
                    taskDescriptionParts.push(`Previous Agent Output:\n${lastOutput}`);
                }
                const handoffPacket = {
                  objective: initialInput || '',
                  process,
                  step: i + 1,
                  total_steps: tasks.length,
                  assigned_agent: { id: agent.id, name: agent.name, role: agent.role },
                  upstream: taskOutputs.slice(-3).map((entry) => ({
                    agent: entry.agentName,
                    role: entry.agentRole,
                    task: entry.task,
                    output: entry.output,
                  })),
                };
                taskDescriptionParts.push(`Handoff Packet (JSON):\n${JSON.stringify(handoffPacket, null, 2)}`);
                const taskWithInput = {
                    ...task,
                    description: taskDescriptionParts.filter(Boolean).join('\n\n'),
                };

                // runAgent is already instrumented, so it will create a child span
                const guardrailLogCallback = (log: any) => {
                  appendLog(log);
                  if (log?.type === 'tool_call') {
                    executionToolCalls += 1;
                    if (maxToolCalls && executionToolCalls > maxToolCalls) {
                      cancelToken.canceled = true;
                      cancelToken.reason = `Guardrail: max tool calls ${maxToolCalls} exceeded`;
                    }
                  }
                };
                const result = await runAgent(
                  agent,
                  taskWithInput,
                  handoffContext,
                  guardrailLogCallback,
                  invocation ?? { initiatedBy: 'crew_kickoff' },
                  { retryOfExecutionId: runMeta?.retryOfExecutionId ?? null }
                );
                
                if (process === 'sequential') {
                    lastOutput = result.text;
                } else {
                    context += `\nOutput from ${agent.role} on task "${task.description}":\n${result.text}\n`;
                    lastOutput = result.text;
                }
                taskOutputs.push({
                  agentName: String(agent.name || `Agent ${agent.id}`),
                  agentRole: String(agent.role || 'specialist'),
                  task: String(task.description || ''),
                  output: String(result.text || ''),
                });

                if (process !== 'hierarchical' && i === 0 && tasks.length > 1) {
                    try {
                        const parsed = JSON.parse(result.text);
                        const plan = Array.isArray(parsed?.plan) ? parsed.plan : null;
                        if (plan && plan.length) {
                            plannerInputs = plan.map((p: any) => String(p));
                            appendLog({ type: 'planner_handoff', plan: plannerInputs });
                        } else if (parsed?.next_input) {
                            plannerInputs = [String(parsed.next_input)];
                            appendLog({ type: 'planner_handoff', plan: plannerInputs });
                        }
                    } catch {
                        // Ignore planner JSON if it's not valid
                    }
                }
                
                // Track usage
                executionPromptTokens += result.usage.prompt_tokens;
                executionCompletionTokens += result.usage.completion_tokens;
                executionCost += result.usage.cost;
                if (maxCostUsd && executionCost > maxCostUsd) {
                  cancelToken.canceled = true;
                  cancelToken.reason = `Guardrail: max cost $${maxCostUsd} exceeded`;
                }

                appendLog({ type: 'finish', agent: agent.name, result: result.text, usage: result.usage });
                
                // Update execution stats progressively
                db.prepare('UPDATE crew_executions SET prompt_tokens = ?, completion_tokens = ?, total_cost = ? WHERE id = ?')
                .run(executionPromptTokens, executionCompletionTokens, executionCost, executionId);
            }

            // Always synthesize a cumulative crew answer so users get a real multi-agent final output.
            let finalCrewResult = String(lastOutput || '');
            if (!cancelToken.canceled) {
                const synthesisSource = taskOutputs
                  .map((entry, idx) => (
                    `Step ${idx + 1}\nAgent: ${entry.agentName} (${entry.agentRole})\nTask: ${entry.task}\nOutput:\n${entry.output}`
                  ))
                  .join('\n\n');
                const synthesisContext = `${context}\n\nCollected Task Outputs:\n${synthesisSource}`;
                const synthesisAgent = process === 'hierarchical'
                  ? (plannerAgentForHierarchy || db.prepare('SELECT * FROM agents WHERE id = ?').get(tasks[0]?.agent_id))
                  : db.prepare('SELECT * FROM agents WHERE id = ?').get(tasks[tasks.length - 1]?.agent_id);

                appendLog({
                  type: 'thought',
                  agent: 'system',
                  message: `Synthesizing ${taskOutputs.length} task outputs into one cumulative crew answer.`,
                });

                if (synthesisAgent && taskOutputs.length > 1) {
                  const synthesisTask = {
                    description: [
                      `Create the final cumulative answer for this ${process} crew run.`,
                      initialInput ? `Original Objective:\n${initialInput}` : '',
                      'You must combine every upstream task output, remove duplicates, resolve conflicts, and provide one coherent final answer.',
                      'Include: (1) final answer, (2) short rationale, (3) assumptions/risks, (4) next actions.',
                    ].filter(Boolean).join('\n\n'),
                    expected_output: 'A unified final crew answer that merges all agent contributions.'
                  };
                  const synthesisResult = await runAgent(
                    synthesisAgent,
                    synthesisTask,
                    synthesisContext,
                    appendLog,
                    invocation ?? { initiatedBy: 'crew_synthesis' },
                    { retryOfExecutionId: runMeta?.retryOfExecutionId ?? null }
                  );
                  executionPromptTokens += synthesisResult.usage.prompt_tokens;
                  executionCompletionTokens += synthesisResult.usage.completion_tokens;
                  executionCost += synthesisResult.usage.cost;
                  finalCrewResult = String(synthesisResult.text || '').trim() || finalCrewResult;
                  appendLog({
                    type: 'crew_summary',
                    agent: synthesisAgent.name || `Agent ${synthesisAgent.id}`,
                    process,
                    result: finalCrewResult,
                    usage: synthesisResult.usage,
                  });
                } else {
                  finalCrewResult = taskOutputs
                    .map((entry, idx) => `Step ${idx + 1} - ${entry.agentName}:\n${entry.output}`)
                    .join('\n\n');
                }

                appendLog({
                  type: 'crew_result',
                  process,
                  result: finalCrewResult,
                  total_steps: taskOutputs.length,
                });

                db.prepare('UPDATE crew_executions SET prompt_tokens = ?, completion_tokens = ?, total_cost = ? WHERE id = ?')
                  .run(executionPromptTokens, executionCompletionTokens, executionCost, executionId);
            }

            const finalCrewStatus = (db.prepare('SELECT status FROM crew_executions WHERE id = ?').get(executionId) as any)?.status;
            if (finalCrewStatus !== 'canceled') {
              db.prepare('UPDATE crew_executions SET status = ? WHERE id = ?').run('completed', executionId);
            }
            span.setStatus({ code: SpanStatusCode.OK });

        } catch (e: any) {
            console.error("Crew execution failed", e);
            span.recordException(e);
            span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });

            db.prepare('INSERT INTO crew_execution_logs (execution_id, type, payload) VALUES (?, ?, ?)')
              .run(executionId, 'error', JSON.stringify({ message: e.message }));
            const finalCrewStatus = (db.prepare('SELECT status FROM crew_executions WHERE id = ?').get(executionId) as any)?.status;
            if (finalCrewStatus !== 'canceled') {
              db.prepare('UPDATE crew_executions SET status = ? WHERE id = ?').run('failed', executionId);
            }
        } finally {
            crewCancelTokens.delete(Number(executionId));
            span.end();
        }
    });
}

function readCrewExecutionLogs(executionId: number | bigint) {
  const rows = db.prepare('SELECT timestamp, type, payload FROM crew_execution_logs WHERE execution_id = ? ORDER BY id ASC').all(executionId) as any[];
  return rows.map((r) => {
    let payload: any = {};
    try { payload = r.payload ? JSON.parse(r.payload) : {}; } catch { payload = {}; }
    return { timestamp: r.timestamp, ...payload, type: r.type };
  });
}

function extractCrewFinalResult(logs: any[]): string {
  if (!Array.isArray(logs) || !logs.length) return '';
  const finalSummary = [...logs].reverse().find((l: any) => l?.type === 'crew_result' || l?.type === 'crew_summary');
  if (finalSummary?.result) return String(finalSummary.result);
  const finishLogs = logs.filter((l: any) => l?.type === 'finish');
  if (!finishLogs.length) return '';
  if (finishLogs.length === 1) return String(finishLogs[0]?.result || '');
  return finishLogs
    .map((l: any, idx: number) => `Step ${idx + 1}${l?.agent ? ` (${l.agent})` : ''}:\n${String(l?.result || '')}`)
    .join('\n\n');
}

app.post('/api/crews/:id/kickoff', localRunLimiter, async (req, res) => {
  const crewId = req.params.id;
  const { initialInput, wait, waitMs, pollMs } = req.body || {};
  
  // Create execution record
  const stmt = db.prepare('INSERT INTO crew_executions (crew_id, status, logs, initial_input, retry_of) VALUES (?, ?, ?, ?, ?)');
  const info = stmt.run(crewId, 'running', JSON.stringify([]), initialInput || '', null);
  const executionId = info.lastInsertRowid;

  // Start processing in background
  await enqueueJob('run_crew', {
    crewId: parseInt(crewId),
    executionId,
    initialInput: initialInput || "",
    initiatedBy: 'crew_kickoff_http',
  });

  const shouldWait = req.query.wait === 'true' || wait === true;
  if (!shouldWait) return res.json({ executionId });

  const timeoutMs = typeof waitMs === 'number' && waitMs > 0 ? waitMs : 120000;
  const intervalMs = typeof pollMs === 'number' && pollMs > 0 ? Math.min(pollMs, 5000) : 1500;
  const startedAt = Date.now();

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  while (Date.now() - startedAt < timeoutMs) {
    const exec = db.prepare('SELECT status FROM crew_executions WHERE id = ?').get(executionId) as any;
    if (!exec) break;
    if (exec.status === 'completed' || exec.status === 'failed' || exec.status === 'canceled') {
      const parsedLogs = readCrewExecutionLogs(executionId);
      const finalResult = extractCrewFinalResult(parsedLogs);
      const lastError = [...parsedLogs].reverse().find((l: any) => l.type === 'error');
      return res.json({
        executionId,
        status: exec.status,
        result: finalResult || null,
        error: exec.status === 'canceled' ? 'Execution canceled' : (lastError?.message ?? null),
        logs: parsedLogs,
      });
    }
    await sleep(intervalMs);
  }

  res.status(202).json({ executionId, status: 'running' });
});

app.get('/api/executions/:id', (req, res) => {
    const execution = db.prepare('SELECT * FROM crew_executions WHERE id = ?').get(req.params.id);
    if (execution) {
        execution.logs = readCrewExecutionLogs(Number(req.params.id));
        res.json(execution);
    } else {
        res.status(404).json({ error: "Execution not found" });
    }
});

app.get('/api/executions/:id/stream', (req, res) => {
  const executionId = Number(req.params.id);
  if (!Number.isFinite(executionId)) return res.status(400).json({ error: 'Invalid execution id' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let lastCount = 0;
  const sendSnapshot = () => {
    const exec = db.prepare('SELECT * FROM crew_executions WHERE id = ?').get(executionId) as any;
    if (!exec) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Execution not found' })}\n\n`);
      return;
    }
    const logs = readCrewExecutionLogs(executionId);
    const payload = { status: exec.status, logs: logs.slice(lastCount), fullLogCount: logs.length };
    lastCount = logs.length;
    res.write(`event: update\ndata: ${JSON.stringify(payload)}\n\n`);
    if (exec.status === 'completed' || exec.status === 'failed' || exec.status === 'canceled') {
      const result = extractCrewFinalResult(logs);
      res.write(`event: done\ndata: ${JSON.stringify({ status: exec.status, result: result || null })}\n\n`);
      clearInterval(timer);
      res.end();
    }
  };

  const timer = setInterval(sendSnapshot, 1200);
  sendSnapshot();
  req.on('close', () => clearInterval(timer));
});

app.post('/api/executions/:id/cancel', async (req, res) => {
  const executionId = Number(req.params.id);
  if (!Number.isFinite(executionId)) return res.status(400).json({ error: 'Invalid execution id' });
  const prisma = getPrisma();
  const exec = await prisma.orchestratorCrewExecution.findUnique({ where: { id: executionId } });
  if (!exec) return res.status(404).json({ error: 'Execution not found' });
  if (exec.status !== 'running') return res.status(409).json({ error: 'Execution is not running' });

  const token = getCancelToken(crewCancelTokens, executionId);
  token.canceled = true;
  token.reason = 'Canceled by user';
  
  await prisma.orchestratorCrewExecution.update({
    where: { id: executionId },
    data: { status: 'canceled' },
  });
  await prisma.orchestratorCrewExecutionLog.create({
    data: {
      executionId: executionId,
      type: 'canceled',
      payload: JSON.stringify({ message: 'Canceled by user' }),
    },
  });

  // Mirror to SQLite
  db.prepare('UPDATE crew_executions SET status = ? WHERE id = ?').run('canceled', executionId);
  db.prepare('INSERT INTO crew_execution_logs (execution_id, type, payload) VALUES (?, ?, ?)')
    .run(executionId, 'canceled', JSON.stringify({ message: 'Canceled by user' }));

  res.json({ success: true });
});

app.post('/api/executions/:id/retry', async (req, res) => {
  const executionId = Number(req.params.id);
  if (!Number.isFinite(executionId)) return res.status(400).json({ error: 'Invalid execution id' });
  const prisma = getPrisma();
  const exec = await prisma.orchestratorCrewExecution.findUnique({ where: { id: executionId } });
  if (!exec) return res.status(404).json({ error: 'Execution not found' });
  const crew = await prisma.orchestratorCrew.findUnique({ where: { id: exec.crewId } });
  if (!crew) return res.status(404).json({ error: 'Crew not found' });

  const newExec = await prisma.orchestratorCrewExecution.create({
    data: {
      crewId: exec.crewId,
      status: 'running',
      logs: JSON.stringify([]),
      initialInput: exec.initialInput || '',
      retryOf: executionId,
    },
  });
  const newExecutionId = newExec.id;

  // Mirror to SQLite
  db.prepare('INSERT INTO crew_executions (id, crew_id, status, logs, initial_input, retry_of) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newExecutionId, exec.crewId, 'running', JSON.stringify([]), exec.initialInput || '', executionId);

  await enqueueJob('run_crew', {
    crewId: Number(exec.crewId),
    executionId: newExecutionId,
    initialInput: exec.initialInput || '',
    initiatedBy: 'retry_crew_execution',
    retryOfExecutionId: executionId,
  });
  res.json({ success: true, executionId: newExecutionId, retry_of: executionId });
});

app.post('/api/executions/:id/resume', async (req, res) => {
  const executionId = Number(req.params.id);
  if (!Number.isFinite(executionId)) return res.status(400).json({ error: 'Invalid execution id' });
  const prisma = getPrisma();
  const exec = await prisma.orchestratorCrewExecution.findUnique({ where: { id: executionId } });
  if (!exec) return res.status(404).json({ error: 'Execution not found' });

  const newExec = await prisma.orchestratorCrewExecution.create({
    data: {
      crewId: exec.crewId,
      status: 'running',
      logs: JSON.stringify([]),
      initialInput: exec.initialInput || '',
      retryOf: executionId,
    },
  });
  const newExecutionId = newExec.id;

  // Mirror to SQLite
  db.prepare('INSERT INTO crew_executions (id, crew_id, status, logs, initial_input, retry_of) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newExecutionId, exec.crewId, 'running', JSON.stringify([]), exec.initialInput || '', executionId);

  await enqueueJob('run_crew', {
    crewId: Number(exec.crewId),
    executionId: newExecutionId,
    initialInput: exec.initialInput || '',
    initiatedBy: 'resume_crew_execution',
    retryOfExecutionId: executionId,
  });
  res.json({ success: true, executionId: newExecutionId, resumed_from: executionId });
});

app.post('/api/agent-executions/:id/cancel', async (req, res) => {
  const execId = Number(req.params.id);
  if (!Number.isFinite(execId)) return res.status(400).json({ error: 'Invalid execution id' });
  const exec = await getRuntimeAgentExecution(execId);
  if (!exec) return res.status(404).json({ error: 'Execution not found' });
  if (exec.status !== 'running') return res.status(409).json({ error: 'Execution is not running' });

  const token = getCancelToken(agentCancelTokens, execId);
  token.canceled = true;
  token.reason = 'Canceled by user';
  await updateRuntimeAgentExecution(execId, { status: 'canceled' });
  await cascadeCancelDelegatedChildren(execId, 'Canceled by user');
  if (exec.agent_id) {
    db.prepare("UPDATE agents SET status = 'idle' WHERE id = ?").run(exec.agent_id);
  }
  res.json({ success: true });
});

app.post('/api/agents/:id/stop-all', async (req, res) => {
  const agentId = Number(req.params.id);
  if (!Number.isFinite(agentId)) return res.status(400).json({ error: 'Invalid agent id' });
  const prisma = getPrisma();
  const agent = await prisma.orchestratorAgent.findUnique({ where: { id: agentId } });
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const runningExecs = await prisma.orchestratorAgentExecution.findMany({
    where: { agentId, status: 'running' },
    select: { id: true }
  });
  for (const row of runningExecs) {
    const token = getCancelToken(agentCancelTokens, Number(row.id));
    token.canceled = true;
    token.reason = 'Canceled by user (stop-all)';
  }
  
  await prisma.orchestratorAgentExecution.updateMany({
    where: { agentId, status: 'running' },
    data: { status: 'canceled' }
  });
  await prisma.orchestratorAgent.update({
    where: { id: agentId },
    data: { status: 'idle' }
  });

  // Mirror to SQLite
  db.prepare("UPDATE agent_executions SET status = 'canceled' WHERE agent_id = ? AND status = 'running'").run(agentId);
  db.prepare("UPDATE agents SET status = 'idle' WHERE id = ?").run(agentId);

  let canceledQueued = 0;
  const queueRows = await prisma.orchestratorJobQueue.findMany({
    where: { 
      type: 'run_agent',
      status: { in: ['pending', 'running'] }
    }
  });

  for (const row of queueRows) {
    let payload: any = {};
    try { payload = row.payload ? JSON.parse(row.payload) : {}; } catch {}
    if (Number(payload?.agentId) !== agentId) continue;
    
    if (row.status === 'pending') {
      await prisma.orchestratorJobQueue.update({
        where: { id: row.id },
        data: { 
          status: 'canceled',
          error: 'Canceled by user (stop-all)',
          finishedAt: new Date()
        }
      });
      // Mirror to SQLite
      db.prepare("UPDATE job_queue SET status = 'canceled', error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run('Canceled by user (stop-all)', row.id);
      canceledQueued++;
    }
  }
  res.json({ success: true, canceled_running_executions: runningExecs.length, canceled_pending_jobs: canceledQueued });
});

app.get('/api/task-control', async (req, res) => {
  try {
    const prisma = getPrisma();
    const [runningAgentExecs, runningCrewExecs, pendingJobsRaw, failedAgentExecs, failedCrewExecs] = await Promise.all([
      prisma.orchestratorAgentExecution.findMany({
        where: { status: 'running' },
        include: { agent: { select: { name: true, role: true } } },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.orchestratorCrewExecution.findMany({
        where: { status: 'running' },
        include: { crew: { select: { name: true, process: true } } },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.orchestratorJobQueue.findMany({
        where: { status: 'pending' },
        orderBy: { id: 'desc' },
        take: 200
      }),
      prisma.orchestratorAgentExecution.findMany({
        where: { status: 'failed' },
        include: { agent: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20
      }),
      prisma.orchestratorCrewExecution.findMany({
        where: { status: 'failed' },
        include: { crew: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20
      })
    ]);

    const runningAgentExecutions = runningAgentExecs.map(ae => ({
      id: ae.id,
      agent_id: ae.agentId,
      task: ae.task,
      created_at: ae.createdAt.toISOString(),
      agent_name: ae.agent?.name,
      agent_role: ae.agent?.role
    }));

    const runningCrewExecutions = runningCrewExecs.map(ce => ({
      id: ce.id,
      crew_id: ce.crewId,
      initial_input: ce.initialInput,
      created_at: ce.createdAt.toISOString(),
      crew_name: ce.crew?.name,
      process: ce.crew?.process
    }));

    const pendingJobs = pendingJobsRaw.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      created_at: row.createdAt.toISOString(),
      payload: row.payload ? JSON.parse(row.payload) : {}
    }));

    const failedAgentExecutions = failedAgentExecs.map(ae => ({
      id: ae.id,
      agent_id: ae.agentId,
      task: ae.task,
      created_at: ae.createdAt.toISOString(),
      agent_name: ae.agent?.name
    }));

    const failedCrewExecutions = failedCrewExecs.map(ce => ({
      id: ce.id,
      crew_id: ce.crewId,
      initial_input: ce.initialInput,
      created_at: ce.createdAt.toISOString(),
      crew_name: ce.crew?.name
    }));

    res.json({
      runningAgentExecutions,
      runningCrewExecutions,
      pendingJobs,
      failedAgentExecutions,
      failedCrewExecutions,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to load task control data' });
  }
});

app.post('/api/task-control/jobs/:id/cancel', async (req, res) => {
  const jobId = Number(req.params.id);
  if (!Number.isFinite(jobId)) return res.status(400).json({ error: 'Invalid job id' });
  const prisma = getPrisma();
  const row = await prisma.orchestratorJobQueue.findUnique({ where: { id: jobId } });
  if (!row) return res.status(404).json({ error: 'Job not found' });
  if (row.status !== 'pending') return res.status(409).json({ error: 'Only pending jobs can be canceled' });
  
  await prisma.orchestratorJobQueue.update({
    where: { id: jobId },
    data: { status: 'canceled', error: 'Canceled by user', finishedAt: new Date() }
  });
  
  // Mirror to SQLite
  db.prepare("UPDATE job_queue SET status = 'canceled', error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run('Canceled by user', jobId);
  res.json({ success: true });
});

app.post('/api/task-control/stop-running-agents', async (req, res) => {
  const prisma = getPrisma();
  const running = await prisma.orchestratorAgentExecution.findMany({
    where: { status: 'running' },
    select: { id: true, agentId: true }
  });
  for (const exec of running) {
    const token = getCancelToken(agentCancelTokens, Number(exec.id));
    token.canceled = true;
    token.reason = 'Canceled by user (bulk stop)';
  }
  
  const updateResult = await prisma.orchestratorAgentExecution.updateMany({
    where: { status: 'running' },
    data: { status: 'canceled' }
  });
  await prisma.orchestratorAgent.updateMany({
    where: { status: 'running' },
    data: { status: 'idle' }
  });

  // Mirror to SQLite
  db.prepare("UPDATE agent_executions SET status = 'canceled' WHERE status = 'running'").run();
  db.prepare("UPDATE agents SET status = 'idle' WHERE status = 'running'").run();
  
  res.json({ success: true, canceled_running_executions: updateResult.count });
});

app.post('/api/task-control/stop-running-crews', async (req, res) => {
  const prisma = getPrisma();
  const running = await prisma.orchestratorCrewExecution.findMany({
    where: { status: 'running' },
    select: { id: true }
  });
  for (const exec of running) {
    const token = getCancelToken(crewCancelTokens, Number(exec.id));
    token.canceled = true;
    token.reason = 'Canceled by user (bulk stop)';
    
    await prisma.orchestratorCrewExecutionLog.create({
      data: {
        executionId: Number(exec.id),
        type: 'canceled',
        payload: JSON.stringify({ message: 'Canceled by user (bulk stop)' })
      }
    });
    
    // Mirror to SQLite
    db.prepare('INSERT INTO crew_execution_logs (execution_id, type, payload) VALUES (?, ?, ?)')
      .run(Number(exec.id), 'canceled', JSON.stringify({ message: 'Canceled by user (bulk stop)' }));
  }
  
  const updateResult = await prisma.orchestratorCrewExecution.updateMany({
    where: { status: 'running' },
    data: { status: 'canceled' }
  });
  
  // Mirror to SQLite
  db.prepare("UPDATE crew_executions SET status = 'canceled' WHERE status = 'running'").run();
  
  res.json({ success: true, canceled_running_executions: updateResult.count });
});

app.post('/api/task-control/cancel-pending-jobs', async (req, res) => {
  const prisma = getPrisma();
  const updateResult = await prisma.orchestratorJobQueue.updateMany({
    where: { status: 'pending' },
    data: { status: 'canceled', error: 'Canceled by user (bulk stop)', finishedAt: new Date() }
  });
  
  // Mirror to SQLite
  db.prepare("UPDATE job_queue SET status = 'canceled', error = ?, finished_at = CURRENT_TIMESTAMP WHERE status = 'pending'")
    .run('Canceled by user (bulk stop)');
    
  res.json({ success: true, canceled_pending_jobs: updateResult.count });
});

app.get('/api/agent-executions/:id/stream', async (req, res) => {
  const execId = Number(req.params.id);
  if (!Number.isFinite(execId)) return res.status(400).json({ error: 'Invalid execution id' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendSnapshot = async () => {
    const exec = await getRuntimeAgentExecution(execId);
    if (!exec) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Execution not found' })}\n\n`);
      clearInterval(timer);
      res.end();
      return;
    }
    const tools = await getPrisma().orchestratorToolExecution.findMany({
      where: { agentExecutionId: execId },
      orderBy: { id: 'asc' },
      select: { id: true, toolName: true, status: true, durationMs: true, createdAt: true },
    });
    const delegations = await getDelegationRows(execId);
    res.write(`event: update\ndata: ${JSON.stringify({ execution: exec, tools, delegations })}\n\n`);
    if (exec.status !== 'running') {
      res.write(`event: done\ndata: ${JSON.stringify({ status: exec.status })}\n\n`);
      clearInterval(timer);
      res.end();
    }
  };
  const timer = setInterval(() => { void sendSnapshot(); }, 1200);
  await sendSnapshot();
  req.on('close', () => clearInterval(timer));
});

app.get('/api/agent-executions/:id/timeline', async (req, res) => {
  const execId = Number(req.params.id);
  if (!Number.isFinite(execId)) return res.status(400).json({ error: 'Invalid execution id' });
  const exec = await getRuntimeAgentExecution(execId);
  if (!exec) return res.status(404).json({ error: 'Execution not found' });
  const toolRows = (await getPrisma().orchestratorToolExecution.findMany({
    where: { agentExecutionId: execId },
    orderBy: { id: 'asc' },
    select: { id: true, toolName: true, status: true, durationMs: true, createdAt: true, error: true },
  })).map((row) => ({
    id: row.id,
    tool_name: row.toolName,
    status: row.status,
    duration_ms: row.durationMs,
    created_at: row.createdAt,
    error: row.error,
  }));
  const delegationRows = await getDelegationRows(execId);
  const timeline = [
    { stage: 'queued', status: 'completed', at: exec.created_at },
    { stage: 'running', status: exec.status === 'running' ? 'running' : 'completed', at: exec.created_at },
    ...delegationRows.map((d) => ({
      stage: `${d.role === 'synthesis' ? 'synthesis' : 'delegate'}:${d.title || d.agent_name || d.agent_id}`,
      status: d.status,
      at: d.created_at,
      error: d.error || null,
      child_execution_id: d.child_execution_id || null,
      child_job_id: d.child_job_id || null,
    })),
    ...toolRows.map((t) => ({
      stage: `tool:${t.tool_name}`,
      status: t.status,
      at: t.created_at,
      duration_ms: t.duration_ms || 0,
      error: t.error || null,
    })),
    { stage: 'finished', status: exec.status, at: exec.created_at },
  ];
  res.json({ execution: exec, timeline, delegations: delegationRows, tools: toolRows });
});

app.post('/api/agent-executions/:id/retry', async (req, res) => {
  const execId = Number(req.params.id);
  if (!Number.isFinite(execId)) return res.status(400).json({ error: 'Invalid execution id' });
  const exec = await getRuntimeAgentExecution(execId);
  if (!exec) return res.status(404).json({ error: 'Execution not found' });
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(exec.agent_id) as any;
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const task = String(exec.task || '').trim();
  if (!task) return res.status(400).json({ error: 'Original task not available for retry' });

  const jobId = await enqueueJob('run_agent', {
    agentId: agent.id,
    task,
    initiatedBy: 'retry_agent_execution',
    retryOfExecutionId: execId,
  });
  const result = await waitForJob(jobId, 120000);
  res.json({ success: true, retry_of: execId, ...result });
});

app.post('/api/agent-executions/:id/resume', async (req, res) => {
  const execId = Number(req.params.id);
  if (!Number.isFinite(execId)) return res.status(400).json({ error: 'Invalid execution id' });
  const exec = await getRuntimeAgentExecution(execId);
  if (!exec) return res.status(404).json({ error: 'Execution not found' });
  const task = String(exec.task || '').trim();
  if (!task) return res.status(400).json({ error: 'Original task not available for resume' });
  const jobId = await enqueueJob('run_agent', {
    agentId: Number(exec.agent_id),
    task,
    initiatedBy: 'resume_agent_execution',
    retryOfExecutionId: execId,
  });
  const result = await waitForJob(jobId, 120000);
  res.json({ success: true, resumed_from: execId, ...result });
});

if (process.env.NODE_ENV === 'production') {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const distDir = path.resolve(__dirname, 'dist');
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/|mcp\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}


// Vite Middleware
let viteServer: ViteDevServer | null = null;
let httpServer: import('http').Server | null = null;
let shuttingDown = false;
let gcsSyncTimer: NodeJS.Timeout | null = null;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nGraceful shutdown (${signal})...`);

  try {
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
      httpServer = null;
    }
  } catch (e) {
    console.error('Failed to close HTTP server:', e);
  }

  try {
    if (viteServer) {
      await viteServer.close();
      viteServer = null;
    }
  } catch (e) {
    console.error('Failed to close Vite server:', e);
  }

  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
  if (gcsSyncTimer) {
    clearInterval(gcsSyncTimer);
    gcsSyncTimer = null;
  }

  try {
    await syncSqliteToGcs(getSqlitePath());
  } catch (e) {
    console.error('Failed to sync SQLite to GCS on shutdown:', e);
  }

  try {
    await closePrisma();
  } catch (e) {
    console.error('Failed to close Prisma:', e);
  }

  try {
    await closeRedis();
  } catch (e) {
    console.error('Failed to close Redis:', e);
  }

  try {
    db.close();
  } catch (e) {
    console.error('Failed to close SQLite DB:', e);
  }

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

function scheduleRetention() {
  const localDays = Number(process.env.LOCAL_RETENTION_DAYS || 30);
  const platformDays = Number(process.env.PLATFORM_RETENTION_DAYS || 0);

  const runCleanup = async () => {
    const now = Date.now();
    if (Number.isFinite(localDays) && localDays > 0) {
      const cutoffDate = new Date(now - localDays * 24 * 60 * 60 * 1000);
      const cutoffIso = cutoffDate.toISOString();
      try {
        const prisma = getPrisma();
        // Prune PostgreSQL (Primary)
        await prisma.orchestratorCrewExecutionLog.deleteMany({ where: { timestamp: { lt: cutoffDate } } });
        await prisma.orchestratorCrewExecution.deleteMany({ where: { createdAt: { lt: cutoffDate }, status: { not: 'running' } } });
        await prisma.orchestratorAgentExecution.deleteMany({ where: { createdAt: { lt: cutoffDate }, status: { not: 'running' } } });
        await prisma.orchestratorToolExecution.deleteMany({ where: { createdAt: { lt: cutoffDate }, status: { not: 'running' } } });
        await prisma.orchestratorJobQueue.deleteMany({ where: { startedAt: { lt: cutoffDate }, status: { notIn: ['pending', 'running'] } } });

        // Prune SQLite (Legacy Mirror)
        try {
          db.prepare("DELETE FROM crew_execution_logs WHERE timestamp < ?").run(cutoffIso);
          db.prepare("DELETE FROM crew_executions WHERE created_at < ? AND status != 'running'").run(cutoffIso);
          db.prepare("DELETE FROM agent_executions WHERE created_at < ? AND status != 'running'").run(cutoffIso);
          db.prepare("DELETE FROM tool_executions WHERE created_at < ? AND status != 'running'").run(cutoffIso);
          db.prepare("DELETE FROM job_queue WHERE finished_at < ? AND status != 'running'").run(cutoffIso);
        } catch (sqliteErr) {
          // Ignore legacy pruning errors if tables don't exist
        }
      } catch (e) {
        console.error('Local retention cleanup failed:', e);
      }
    }

    if (Number.isFinite(platformDays) && platformDays > 0) {
      const cutoff = new Date(now - platformDays * 24 * 60 * 60 * 1000);
      try {
        const prisma = getPrisma();
        await prisma.runEvent.deleteMany({ where: { ts: { lt: cutoff } } });
        await prisma.run.deleteMany({ where: { startedAt: { lt: cutoff }, status: { not: 'running' } } });
      } catch (e) {
        console.error('Platform retention cleanup failed:', e);
      }
    }
  };

  runCleanup().catch(() => undefined);
  setInterval(() => runCleanup().catch(() => undefined), 24 * 60 * 60 * 1000);
}

async function startServer() {
  // Initialize Database first
  initDb();

  function ensureDefaultPricing() {
    const upsert = db.prepare(`
      INSERT INTO model_pricing (model, input_usd, output_usd)
      VALUES (?, ?, ?)
      ON CONFLICT(model) DO UPDATE SET
        input_usd = excluded.input_usd,
        output_usd = excluded.output_usd
    `);
    const tx = db.transaction(() => {
      for (const [model, price] of Object.entries(DEFAULT_PRICING)) {
        upsert.run(model, price.input, price.output);
      }
    });
    tx();
  }

  try {
    const prisma = getPrisma();
    await prisma.orchestratorAgent.updateMany({
      data: { status: 'idle' },
    });
    await refreshPersistentMirror();
    
    // Now that mirror is synced, ensure pricing is there (it writes to memory db)
    ensureDefaultPricing();
  } catch (e) {
    console.error('Failed to initialize database mirror from Postgres:', e);
  }

  recoverStaleExecutionState();

  try {
    await initRedis();
  } catch (e) {
    console.error('Redis initialization failed:', e);
  }

  if (process.env.NODE_ENV !== 'production') {
    viteServer = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(viteServer.middlewares);
  }

  httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  scheduleRetention();
  startJobWorker();
  gcsSyncTimer = startSqliteGcsSyncLoop(getSqlitePath());
}

if (
  process.env.AUTO_START !== 'false' &&
  process.env.NODE_ENV !== 'test' &&
  process.env.VITEST !== 'true'
) {
  startServer();
}

export { app, startServer };
