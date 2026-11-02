// Plain-text report of an import plan, for the command line (and easy to read in a log).

const ENTITY_LABELS = {
  driver: 'Drivers', team: 'Teams', circuit: 'Grand Prix / circuits',
  legacy_driver_totals: 'Driver career totals (legacy)', legacy_team_totals: 'Team career totals (legacy)',
  legacy_team_history: 'Driver team history (no years)', gp_winner: 'Grand Prix winners', circuit_record: 'Circuit records',
};
const STATUS_TEXT = {
  ready: 'READY TO IMPORT (nothing has been saved yet)',
  conflicts_only: 'NOTHING NEW. Some items differ from what is saved (kept unless you overwrite them)',
  no_changes: 'NOTHING TO IMPORT. Everything is already in the archive',
  already_imported: 'THIS EXACT FILE WAS ALREADY IMPORTED. It cannot be imported again',
  blocked: 'BLOCKED. Fix the problems below first',
};
const pad = (s, n) => String(s).padEnd(n);

export function renderPlanText(plan) {
  const lines = [];
  lines.push(`IMPORT PREVIEW: ${plan.file.name} (${plan.file.size.toLocaleString('en-US')} bytes)`);
  lines.push(`File fingerprint (SHA-256): ${plan.file.sha256}`);
  lines.push(`Status: ${STATUS_TEXT[plan.status] || plan.status}`);
  if (plan.alreadyImported) lines.push(`Already imported as batch #${plan.alreadyImported.batch_id}.`);
  if (plan.blankPolicy) lines.push(`Blank cells in count columns: ${plan.blankPolicy === 'zero' ? 'counted as 0 (as agreed)' : 'kept UNKNOWN'}`);
  lines.push('');

  if (plan.actions.length) {
    lines.push('What would happen');
    lines.push(`  ${pad('', 34)}${pad('new', 7)}${pad('same', 7)}conflicts`);
    for (const [entity, c] of Object.entries(plan.summary.by_entity)) {
      lines.push(`  ${pad(ENTITY_LABELS[entity] || entity, 34)}${pad(c.create, 7)}${pad(c.unchanged, 7)}${c.conflict}`);
    }
    lines.push('');
  }

  const byGroup = (severity) => plan.issues.filter((i) => i.severity === severity);
  const section = (title, list, max = 12) => {
    if (!list.length) return;
    lines.push(`${title} (${list.length})`);
    for (const i of list.slice(0, max)) lines.push(`  - ${i.message}${i.ack_key ? `   [acknowledge key: ${i.ack_key}]` : ''}`);
    if (list.length > max) lines.push(`  ... and ${list.length - max} more`);
    lines.push('');
  };
  section('ERRORS: must be fixed before importing', byGroup('error'), 30);
  section('NEEDS YOUR ACKNOWLEDGEMENT', byGroup('review_required'));
  section('PENDING YOUR APPROVAL (imported unchanged, flagged for review)', byGroup('pending_review'));
  section('WARNINGS: imported as written, worth a look', byGroup('warning'));
  section('Notes', byGroup('info'), 20);

  if (plan.conflicts.length) {
    lines.push(`Conflicts: saved data differs from the file (${plan.conflicts.length}). They are KEPT unless you overwrite them on purpose.`);
    for (const c of plan.conflicts.slice(0, 10)) {
      lines.push(`  - ${c.label}  [${c.resolution_key}]`);
      for (const ch of (c.changes || []).slice(0, 4)) lines.push(`      ${ch.field}: saved ${ch.existing}  |  file ${ch.incoming}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
