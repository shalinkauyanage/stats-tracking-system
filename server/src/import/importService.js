// The import SERVICE: the two things the app (or command line) can do.
//
//   previewImport  read the file, check it, compare with the database. WRITES NOTHING.
//   commitImport   re-read the same file and, inside one transaction, re-check against the
//                  CURRENT database and save. All or nothing.
//
// The file is never stored on the server: the preview and the commit each receive the
// file itself, and commit refuses if its fingerprint (SHA-256) differs from the one that
// was previewed. That way what you reviewed is exactly what gets imported.

import { parseWorkbookFile } from './workbookLayout.js';
import { buildLegacyDataset } from '../logic/legacyBuilder.js';
import { planImport } from './importPlanner.js';
import { executePlan, countChanges } from './importExecutor.js';
import { ImportBlockedError, ImportMismatchError, ImportFileError } from './errors.js';

const BLANK_POLICIES = ['zero', 'unknown'];

function prepare(buffer, fileName, options = {}) {
  const blankPolicy = options.blankPolicy ?? 'zero';
  if (!BLANK_POLICIES.includes(blankPolicy)) throw new ImportFileError(`blank policy must be one of: ${BLANK_POLICIES.join(', ')}`, 'bad_option');
  const parsed = parseWorkbookFile(buffer, fileName);
  const dataset = parsed.snapshot ? buildLegacyDataset(parsed.snapshot, { blankPolicy }) : null;
  return { parsed, dataset, blankPolicy };
}

export async function previewImport({ repo, buffer, fileName, options = {} }) {
  const { parsed, dataset, blankPolicy } = prepare(buffer, fileName, options);
  const state = await repo.loadState();
  const plan = planImport(dataset, state, parsed.file, { readIssues: parsed.issues, acknowledged: options.acknowledged || [] });
  return { ...plan, blankPolicy };
}

export async function commitImport({ repo, buffer, fileName, expectedSha256, options = {}, resolutions = {} }) {
  const { parsed, dataset, blankPolicy } = prepare(buffer, fileName, options);
  if (!expectedSha256) throw new ImportMismatchError('Commit needs the fingerprint (SHA-256) of the file you previewed.');
  if (expectedSha256 !== parsed.file.sha256) {
    throw new ImportMismatchError('This is not the file you previewed (its fingerprint is different). Preview it again before importing.');
  }

  try {
    return await repo.transaction(async (tx) => {
      const state = await tx.loadState();           // fresh look at the CURRENT database
      const plan = planImport(dataset, state, parsed.file, { readIssues: parsed.issues, acknowledged: options.acknowledged || [] });
      plan.blankPolicy = blankPolicy;

      if (plan.status === 'blocked') {
        throw new ImportBlockedError('The import is blocked: fix the listed problems first.', plan);
      }
      if (plan.status === 'already_imported') {
        return { status: 'already_imported', already_imported: plan.alreadyImported, message: 'This exact file was already imported. Nothing was changed.' };
      }
      if (countChanges(plan, resolutions) === 0) {
        return { status: 'no_changes', conflicts: plan.conflicts.length, message: 'Everything in the file is already in the archive. Nothing was changed.' };
      }
      return executePlan(tx, plan, { resolutions });
    });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY' && /committed_sha256|uq_import_committed_sha/.test(String(err.message))) {
      return { status: 'already_imported', message: 'This exact file was imported a moment ago. Nothing was changed.' };
    }
    if (!(err instanceof ImportBlockedError)) {
      // the transaction has been rolled back; keep a note that the attempt failed
      try {
        await repo.recordFailedBatch({ file_name: parsed.file.name, file_sha256: parsed.file.sha256, file_size: parsed.file.size, error: err.message });
      } catch { /* the failure note is best-effort */ }
    }
    throw err;
  }
}

/** A plan without the bulky internals, safe to send to the browser. */
export function serializePlan(plan) {
  const { dataset, ...rest } = plan;
  void dataset;
  return rest;
}
