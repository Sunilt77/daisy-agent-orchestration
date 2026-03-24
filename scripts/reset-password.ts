import 'dotenv/config';
import { getPrisma } from '../src/platform/prisma';
import { hashPassword } from '../src/platform/auth';

async function main() {
  const prisma = getPrisma();

  const email = String(process.env.RESET_EMAIL || '').toLowerCase().trim();
  const password = String(process.env.RESET_PASSWORD || '');

  if (!email) throw new Error('RESET_EMAIL is required');
  if (!password || password.length < 8) throw new Error('RESET_PASSWORD is required (min 8 chars)');

  const user = await prisma.user.findFirst({ where: { email } });
  if (!user) throw new Error(`User not found: ${email}`);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password) },
  });

  // eslint-disable-next-line no-console
  console.log(`Password reset for ${email}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });

