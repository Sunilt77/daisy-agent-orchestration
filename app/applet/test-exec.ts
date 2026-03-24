import { exec } from 'child_process';
import util from 'util';
const execAsync = util.promisify(exec);

async function run() {
  const { stdout } = await execAsync('node -e "console.log(42)"');
  console.log(stdout);
}
run();
