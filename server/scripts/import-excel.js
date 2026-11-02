// Command-line importer. Examples (PowerShell, from the server folder):
//
//   npm run import:preview -- ..\data\original\F1.xlsx
//   npm run import:commit  -- ..\data\original\F1.xlsx --yes
//   npm run import:history
//
// Options
//   --blanks=zero|unknown   how blank count cells are treated (default zero)
//   --ack=KEY               acknowledge one "needs your acknowledgement" item (repeatable)
//   --ack-all               acknowledge all of them
//   --overwrite=KEY         overwrite one conflicting item on purpose (repeatable)
//   --overwrite-all         overwrite every conflict (rarely a good idea)
//   --no-db                 preview only: compare against an EMPTY archive, no MySQL needed
import fs from 'node:fs';
import path from 'node:path';
import { previewImport, commitImport } from '../src/import/importService.js';
import { renderPlanText } from '../src/import/report.js';
import { MemoryImportRepo } from '../src/import/importRepo.memory.js';
import { ImportFileError, ImportBlockedError, ImportMismatchError } from '../src/import/errors.js';

const [command, ...rest] = process.argv.slice(2);
const flags = { ack: [], overwrite: [] };
const positional = [];
for (const arg of rest) {
  if (arg === '--yes') flags.yes = true;
  else if (arg === '--ack-all') flags.ackAll = true;
  else if (arg === '--overwrite-all') flags.overwriteAll = true;
  else if (arg === '--no-db') flags.noDb = true;
  else if (arg.startsWith('--blanks=')) flags.blanks = arg.slice(9);
  else if (arg.startsWith('--ack=')) flags.ack.push(arg.slice(6));
  else if (arg.startsWith('--overwrite=')) flags.overwrite.push(arg.slice(12));
  else if (arg.startsWith('--')) { console.error(`Unknown option ${arg}`); process.exit(2); }
  else positional.push(arg);
}

async function openRepo() {
  if (flags.noDb) return { repo: new MemoryImportRepo(), close: async () => {} };
  const { getPool } = await import('../src/db/pool.js');
  const { MysqlImportRepo } = await import('../src/import/importRepo.mysql.js');
  const pool = getPool();
  return { repo: new MysqlImportRepo(pool), close: () => pool.end() };
}

async function main() {
  if (!['preview', 'commit', 'history'].includes(command)) {
    console.log('Usage: npm run import:preview -- <file.xlsx> | import:commit -- <file.xlsx> --yes | import:history');
    process.exit(2);
  }
  const { repo, close } = await openRepo();
  try {
    if (command === 'history') {
      const batches = await repo.listBatches();
      if (!batches.length) console.log('No imports yet.');
      for (const b of batches) console.log(`#${b.id}  ${b.status.padEnd(9)}  ${b.file_name}  ${String(b.committed_at || b.created_at || '').slice(0, 19)}  ${b.error_message || ''}`);
      const open = await repo.listIssues({ status: 'open' });
      if (open.length) { console.log(`\n${open.length} open review item(s):`); for (const i of open) console.log(`  - [${i.severity}] ${i.message}`); }
      return;
    }

    const file = positional[0];
    if (!file) { console.error('Give the path of the .xlsx file.'); process.exit(2); }
    const buffer = fs.readFileSync(file);
    const fileName = path.basename(file);
    const options = { blankPolicy: flags.blanks || 'zero', acknowledged: flags.ack };

    let plan = await previewImport({ repo, buffer, fileName, options });
    if (flags.ackAll) {
      options.acknowledged = plan.reviewRequired.map((i) => i.ack_key);
      plan = await previewImport({ repo, buffer, fileName, options });
    }
    console.log(renderPlanText(plan));
    if (flags.noDb) console.log('(Preview against an EMPTY archive; no database was used.)');

    if (command === 'commit') {
      if (!flags.yes) { console.log('\nNothing was imported. Review the preview above, then add --yes to import.'); return; }
      if (flags.noDb) { console.error('\nCannot import without a database. Remove --no-db.'); process.exitCode = 1; return; }
      const resolutions = {};
      if (flags.overwriteAll) resolutions['*'] = 'overwrite';
      for (const k of flags.overwrite) resolutions[k] = 'overwrite';
      const result = await commitImport({ repo, buffer, fileName, expectedSha256: plan.file.sha256, options, resolutions });
      console.log('\nRESULT:', result.status);
      if (result.message) console.log(result.message);
      if (result.status === 'imported') {
        console.log(`Batch #${result.batch_id} saved.`);
        console.log('Created:', JSON.stringify(result.created));
        if (Object.keys(result.updated).length) console.log('Overwritten on purpose:', JSON.stringify(result.updated));
        if (result.kept_conflicts) console.log(`${result.kept_conflicts} conflicting item(s) were kept as they were.`);
        console.log(`${result.issues_recorded} review item(s) saved. See them with: npm run import:history`);
      }
    }
  } catch (err) {
    if (err instanceof ImportBlockedError) { console.error('\nBlocked:', err.message); console.error(renderPlanText(err.plan)); }
    else if (err instanceof ImportFileError || err instanceof ImportMismatchError) console.error('\n' + err.message);
    else console.error('\nUnexpected problem: ' + err.message);
    process.exitCode = 1;
  } finally {
    await close();
  }
}
main();
