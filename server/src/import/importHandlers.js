// The logic behind the import web routes, written as plain functions (no Express) so it
// can be tested directly. routes/importRoutes.js is a thin wrapper around these.
//
// Each handler returns { status, json }.

import { previewImport, commitImport, serializePlan } from './importService.js';
import { ImportFileError, ImportBlockedError, ImportMismatchError } from './errors.js';

const asList = (value) => (value === undefined || value === null ? [] : [].concat(value).map(String).filter(Boolean));

export function optionsFromQuery(query = {}) {
  return { blankPolicy: query.blank_policy || 'zero', acknowledged: asList(query.acknowledged) };
}

export function resolutionsFromQuery(query = {}) {
  const resolutions = {};
  if (query.overwrite_all === 'yes') resolutions['*'] = 'overwrite';
  for (const key of asList(query.overwrite)) resolutions[key] = 'overwrite';
  return resolutions;
}

function errorResponse(err) {
  if (err instanceof ImportFileError) return { status: err.code === 'too_large' ? 413 : 400, json: { error: { code: err.code, message: err.message } } };
  if (err instanceof ImportMismatchError) return { status: 409, json: { error: { code: err.code, message: err.message } } };
  if (err instanceof ImportBlockedError) return { status: 409, json: { error: { code: err.code, message: err.message }, plan: serializePlan(err.plan) } };
  return null;
}

export async function handlePreview({ repo, body, fileName, query }) {
  try {
    const plan = await previewImport({ repo, buffer: body, fileName, options: optionsFromQuery(query) });
    return { status: 200, json: serializePlan(plan) };
  } catch (err) {
    const mapped = errorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}

export async function handleCommit({ repo, body, fileName, query }) {
  if (query?.confirm !== 'yes') {
    return { status: 400, json: { error: { code: 'confirmation_required', message: 'Add confirm=yes to confirm that you reviewed the preview.' } } };
  }
  try {
    const result = await commitImport({
      repo, buffer: body, fileName,
      expectedSha256: query.expected_sha256,
      options: optionsFromQuery(query),
      resolutions: resolutionsFromQuery(query),
    });
    return { status: result.status === 'imported' ? 201 : 200, json: result };
  } catch (err) {
    const mapped = errorResponse(err);
    if (mapped) return mapped;
    throw err;
  }
}

export async function handleBatches({ repo }) {
  return { status: 200, json: { batches: await repo.listBatches() } };
}

export async function handleIssues({ repo, query }) {
  return { status: 200, json: { issues: await repo.listIssues({ status: query?.status }) } };
}
