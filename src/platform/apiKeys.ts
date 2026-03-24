import { nanoid } from 'nanoid';
import { getPrisma } from './prisma';
import { hashApiKey } from './crypto';
import { HttpError } from './httpErrors';

export function generateApiKey(): string {
  return `ak_${nanoid(32)}`;
}

export async function createProjectApiKey(params: { projectId: string; name: string }) {
  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);
  const prisma = getPrisma();

  const apiKey = await prisma.projectApiKey.create({
    data: {
      projectId: params.projectId,
      name: params.name,
      keyHash,
    },
  });

  return { apiKey, rawKey };
}

export async function verifyProjectApiKey(rawKey: string) {
  const prisma = getPrisma();
  const keyHash = hashApiKey(rawKey);
  const apiKey = await prisma.projectApiKey.findFirst({
    where: { keyHash, revokedAt: null },
    include: { project: true },
  });
  if (!apiKey) throw new HttpError(401, 'Invalid API key');

  await prisma.projectApiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  return apiKey;
}

