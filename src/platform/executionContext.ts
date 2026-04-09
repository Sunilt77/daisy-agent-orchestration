import crypto from 'crypto';
import { z } from 'zod';
import { HttpError } from './httpErrors';
import { ensurePrismaReady } from './prisma';

const EXECUTION_CONTEXT_TOKEN_AUD = process.env.EXECUTION_CONTEXT_TOKEN_AUDIENCE || 'agentic-orchestrator';
const EXECUTION_CONTEXT_TOKEN_SECRET = process.env.EXECUTION_CONTEXT_TOKEN_SECRET || process.env.APP_SECRET || '';
const DELEGATED_TOOL_TOKEN_AUD = process.env.DELEGATED_TOOL_TOKEN_AUDIENCE || 'app-mcp-gateway';
const DELEGATED_TOOL_TOKEN_SECRET = process.env.DELEGATED_TOOL_TOKEN_SECRET || process.env.APP_SECRET || '';

export const ExecutionContextTokenClaimsSchema = z.object({
  iss: z.string().min(1),
  aud: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  sub: z.string().min(1),
  app_id: z.string().uuid(),
  org_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  tenant_external_id: z.string().min(1).max(200),
  user_external_id: z.string().min(1).max(200),
  conversation_id: z.string().max(200).optional(),
  session_id: z.string().max(200).optional(),
  roles: z.array(z.string().min(1).max(120)).optional(),
  scopes: z.array(z.string().min(1).max(200)).optional(),
  allowed_tools: z.array(z.string().min(1).max(200)).optional(),
  credential_refs: z.array(z.string().min(1).max(300)).optional(),
  jti: z.string().min(1).max(200),
  iat: z.number().int().optional(),
  exp: z.number().int(),
});

export type ExecutionContextTokenClaims = z.infer<typeof ExecutionContextTokenClaimsSchema>;

export const DelegatedToolTokenClaimsSchema = z.object({
  iss: z.string().min(1),
  aud: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  sub: z.string().min(1),
  execution_context_id: z.string().uuid(),
  tenant_external_id: z.string().min(1).max(200),
  user_external_id: z.string().min(1).max(200),
  allowed_tool: z.string().min(1).max(200),
  credential_refs: z.array(z.string().min(1).max(300)).optional(),
  required_scopes: z.array(z.string().min(1).max(200)).optional(),
  request_id: z.string().min(1).max(200).optional(),
  jti: z.string().min(1).max(200),
  iat: z.number().int().optional(),
  exp: z.number().int(),
});

export type DelegatedToolTokenClaims = z.infer<typeof DelegatedToolTokenClaimsSchema>;

type SignExecutionContextTokenOptions = {
  ttlSeconds?: number;
  nowMs?: number;
};

type VerifyExecutionContextTokenOptions = {
  nowMs?: number;
  expectedAudience?: string;
};

type VerifyDelegatedToolTokenOptions = {
  nowMs?: number;
  expectedAudience?: string;
};

function assertTokenSecret() {
  if (!EXECUTION_CONTEXT_TOKEN_SECRET || EXECUTION_CONTEXT_TOKEN_SECRET.length < 32) {
    throw new Error('Execution context token secret is not configured. Set EXECUTION_CONTEXT_TOKEN_SECRET or APP_SECRET (32+ chars).');
  }
}

function assertDelegatedToolSecret() {
  if (!DELEGATED_TOOL_TOKEN_SECRET || DELEGATED_TOOL_TOKEN_SECRET.length < 32) {
    throw new Error('Delegated tool token secret is not configured. Set DELEGATED_TOOL_TOKEN_SECRET or APP_SECRET (32+ chars).');
  }
}

function base64urlEncode(input: string | Buffer) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64urlDecode(input: string) {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(`${normalized}${'='.repeat(padLength)}`, 'base64').toString('utf8');
}

function signParts(headerPart: string, payloadPart: string) {
  assertTokenSecret();
  return base64urlEncode(
    crypto
      .createHmac('sha256', EXECUTION_CONTEXT_TOKEN_SECRET)
      .update(`${headerPart}.${payloadPart}`)
      .digest(),
  );
}

function signPartsWithSecret(headerPart: string, payloadPart: string, secret: string) {
  return base64urlEncode(
    crypto
      .createHmac('sha256', secret)
      .update(`${headerPart}.${payloadPart}`)
      .digest(),
  );
}

function parseCredentialRef(credentialRef: string) {
  const trimmed = String(credentialRef || '').trim();
  if (!trimmed) return null;
  const separator = trimmed.indexOf(':');
  if (separator <= 0) {
    return {
      provider: 'default',
      credentialRef: trimmed,
    };
  }
  return {
    provider: trimmed.slice(0, separator).trim() || 'default',
    credentialRef: trimmed.slice(separator + 1).trim() || trimmed,
  };
}

export function signExecutionContextToken(
  input: Omit<ExecutionContextTokenClaims, 'iat' | 'exp'>,
  options: SignExecutionContextTokenOptions = {},
) {
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const iat = Math.floor(nowMs / 1000);
  const ttlSeconds = Number.isFinite(options.ttlSeconds) ? Math.max(Number(options.ttlSeconds), 1) : 600;
  const claims: ExecutionContextTokenClaims = {
    ...input,
    iat,
    exp: iat + ttlSeconds,
  };

  const payload = ExecutionContextTokenClaimsSchema.parse(claims);
  const headerPart = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadPart = base64urlEncode(JSON.stringify(payload));
  const signaturePart = signParts(headerPart, payloadPart);
  return `${headerPart}.${payloadPart}.${signaturePart}`;
}

export function signDelegatedToolToken(
  input: Omit<DelegatedToolTokenClaims, 'iat' | 'exp' | 'aud'> & { aud?: string | string[] },
  options: SignExecutionContextTokenOptions = {},
) {
  assertDelegatedToolSecret();
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const iat = Math.floor(nowMs / 1000);
  const ttlSeconds = Number.isFinite(options.ttlSeconds) ? Math.max(Number(options.ttlSeconds), 1) : 90;
  const claims: DelegatedToolTokenClaims = {
    ...input,
    aud: input.aud || DELEGATED_TOOL_TOKEN_AUD,
    iat,
    exp: iat + ttlSeconds,
  };

  const payload = DelegatedToolTokenClaimsSchema.parse(claims);
  const headerPart = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadPart = base64urlEncode(JSON.stringify(payload));
  const signaturePart = signPartsWithSecret(headerPart, payloadPart, DELEGATED_TOOL_TOKEN_SECRET);
  return `${headerPart}.${payloadPart}.${signaturePart}`;
}

export function verifyExecutionContextToken(token: string, options: VerifyExecutionContextTokenOptions = {}) {
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Invalid execution context token');

  const [headerPart, payloadPart, signaturePart] = parts;
  const expectedSignature = signParts(headerPart, payloadPart);
  const signatureBuffer = Buffer.from(signaturePart);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw new HttpError(401, 'Invalid execution context token signature');
  }

  let payloadRaw = '';
  try {
    payloadRaw = base64urlDecode(payloadPart);
  } catch {
    throw new HttpError(401, 'Invalid execution context token payload');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    throw new HttpError(401, 'Invalid execution context token payload');
  }

  const claims = ExecutionContextTokenClaimsSchema.parse(payload);
  const expectedAudience = String(options.expectedAudience || EXECUTION_CONTEXT_TOKEN_AUD).trim();
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (expectedAudience && !audiences.includes(expectedAudience)) {
    throw new HttpError(403, 'Execution context audience mismatch');
  }

  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);
  if (claims.exp <= nowSeconds) {
    throw new HttpError(401, 'Execution context token expired');
  }

  return claims;
}

export function verifyDelegatedToolToken(token: string, options: VerifyDelegatedToolTokenOptions = {}) {
  assertDelegatedToolSecret();
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Invalid delegated tool token');

  const [headerPart, payloadPart, signaturePart] = parts;
  const expectedSignature = signPartsWithSecret(headerPart, payloadPart, DELEGATED_TOOL_TOKEN_SECRET);
  const signatureBuffer = Buffer.from(signaturePart);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw new HttpError(401, 'Invalid delegated tool token signature');
  }

  let payloadRaw = '';
  try {
    payloadRaw = base64urlDecode(payloadPart);
  } catch {
    throw new HttpError(401, 'Invalid delegated tool token payload');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    throw new HttpError(401, 'Invalid delegated tool token payload');
  }

  const claims = DelegatedToolTokenClaimsSchema.parse(payload);
  const expectedAudience = String(options.expectedAudience || DELEGATED_TOOL_TOKEN_AUD).trim();
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (expectedAudience && !audiences.includes(expectedAudience)) {
    throw new HttpError(403, 'Delegated tool token audience mismatch');
  }

  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);
  if (claims.exp <= nowSeconds) {
    throw new HttpError(401, 'Delegated tool token expired');
  }

  return claims;
}

export async function createExecutionContextFromToken(token: string) {
  const claims = verifyExecutionContextToken(token);
  const prisma = await ensurePrismaReady();

  const application = await prisma.connectedApplication.findUnique({
    where: { id: claims.app_id },
    select: { id: true, tokenIssuer: true, tokenAudience: true, status: true },
  });
  if (!application || application.status !== 'active') {
    throw new HttpError(403, 'Connected application is unavailable');
  }
  if (application.tokenIssuer !== claims.iss) {
    throw new HttpError(403, 'Execution context issuer mismatch');
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(application.tokenAudience)) {
    throw new HttpError(403, 'Execution context audience mismatch');
  }

  if (claims.project_id) {
    const project = await prisma.project.findFirst({
      where: { id: claims.project_id, orgId: claims.org_id },
      select: { id: true },
    });
    if (!project) throw new HttpError(403, 'Project does not belong to org');
  }

  const context = await prisma.agentExecutionContext.create({
    data: {
      applicationId: claims.app_id,
      orgId: claims.org_id,
      projectId: claims.project_id ?? null,
      tenantExternalId: claims.tenant_external_id,
      userExternalId: claims.user_external_id,
      conversationId: claims.conversation_id ?? null,
      sessionId: claims.session_id ?? null,
      rolesJson: claims.roles ?? [],
      scopesJson: claims.scopes ?? [],
      allowedToolsJson: claims.allowed_tools ?? [],
      credentialRefsJson: claims.credential_refs ?? [],
      sourceTokenJti: claims.jti,
      status: 'active',
      expiresAt: new Date(claims.exp * 1000),
    },
  });

  const parsedCredentialBindings = (claims.credential_refs || [])
    .map(parseCredentialRef)
    .filter((row): row is { provider: string; credentialRef: string } => Boolean(row));

  if (parsedCredentialBindings.length) {
    await prisma.agentCredentialBinding.createMany({
      data: parsedCredentialBindings.map((binding) => ({
        id: crypto.randomUUID(),
        executionContextId: context.id,
        provider: binding.provider,
        credentialRef: binding.credentialRef,
        subjectType: 'user',
        subjectExternalId: claims.user_external_id,
        scopesJson: claims.scopes ?? [],
      })),
    });
  }

  return context;
}

export async function revokeExecutionContext(executionContextId: string) {
  const prisma = await ensurePrismaReady();
  await prisma.agentExecutionContext.updateMany({
    where: { id: executionContextId, revokedAt: null },
    data: { status: 'revoked', revokedAt: new Date() },
  });
}
