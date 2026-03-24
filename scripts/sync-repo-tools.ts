import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getPrisma } from '../src/platform/prisma.js';
import { refreshPersistentMirror } from '../src/orchestrator/sqliteMirror.js';

async function sync() {
  const prisma = getPrisma();
  const args = process.argv.slice(2);
  const gitUrl = args.find(a => a.startsWith('--git='))?.split('=')[1];
  
  let toolsDir = path.resolve(process.cwd(), 'tools');

  if (gitUrl) {
    const tempDir = path.resolve(process.cwd(), 'tmp-repo-sync-' + Date.now());
    console.log(`Cloning repository ${gitUrl} to ${tempDir}...`);
    execSync(`git clone ${gitUrl} ${tempDir}`, { stdio: 'inherit' });
    toolsDir = tempDir;
  }

  if (!fs.existsSync(toolsDir)) {
    console.log('No tools directory found at', toolsDir);
    return;
  }

  console.log('Scanning directory for tools:', toolsDir);
  const files = getAllFiles(toolsDir);
  
  for (const file of files) {
    let metadata: any = null;

    if (file.endsWith('.json')) {
      try {
        metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        console.warn(`Failed to parse JSON tool: ${file}`);
      }
    } else if (file.endsWith('.py') || file.endsWith('.js') || file.endsWith('.ts')) {
      metadata = extractMetadataFromFile(file);
    }

    if (metadata && metadata.name) {
      const { name, description, category, type, config } = metadata;
      const serializedConfig = config ? (typeof config === 'string' ? config : JSON.stringify(config)) : '{}';
      
      const existing = await prisma.orchestratorTool.findFirst({ where: { name } });
      if (existing) {
        await prisma.orchestratorTool.update({
          where: { id: existing.id },
          data: {
            description: description || existing.description,
            category: category || existing.category,
            type: type || existing.type,
            config: serializedConfig,
            updatedAt: new Date(),
          },
        });
      } else {
        await prisma.orchestratorTool.create({
          data: {
            name,
            description: description || `Auto-imported tool from ${path.basename(file)}`,
            category: category || 'imported',
            type: type || (file.endsWith('.py') ? 'python' : 'custom'),
            config: serializedConfig,
            version: 1,
          },
        });
      }
      console.log(`- Synced tool: ${name} (${path.basename(file)})`);
    }
  }

  await refreshPersistentMirror();
  await prisma.$disconnect();
  console.log('Sync complete!');
}

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
  const files = fs.readdirSync(dirPath);
  files.forEach(function(file) {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
      }
    } else {
      arrayOfFiles.push(path.join(dirPath, "/", file));
    }
  });
  return arrayOfFiles;
}

function extractMetadataFromFile(filePath: string): any {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const metadata: any = {
    name: path.basename(filePath, path.extname(filePath)),
    type: filePath.endsWith('.py') ? 'python' : 'custom',
    config: { code: content }
  };

  // Simple extraction of @name, @description from comments
  for (const line of lines) {
    if (line.includes('@name')) metadata.name = line.split('@name')[1].trim();
    if (line.includes('@description')) metadata.description = line.split('@description')[1].trim();
    if (line.includes('@category')) metadata.category = line.split('@category')[1].trim();
    if (line.includes('@type')) metadata.type = line.split('@type')[1].trim();
  }

  return metadata;
}

sync()
  .catch((e) => {
    console.error('Sync failed:', e);
    process.exit(1);
  });
