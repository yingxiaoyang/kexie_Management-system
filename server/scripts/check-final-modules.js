import assert from 'node:assert/strict';
import fs from 'node:fs';
import { archiveMaterialState } from '../src/services/archiveExportService.js';
import {
  canAutoReleaseRestriction,
  hasActiveRestrictionForYear,
  restrictionAppliesToYear,
  restrictionYearFor
} from '../src/services/participationEligibilityService.js';
import { normalizeArchiveTemplateConfig, safeSpreadsheetText } from '../src/utils/archive.js';

assert.equal(restrictionYearFor(2026), 2027);
assert.equal(restrictionYearFor(2027), 2028);
assert.equal(restrictionAppliesToYear(2026, 2027), true);
assert.equal(restrictionAppliesToYear(2026, 2028), false);
assert.equal(canAutoReleaseRestriction('missing_required_material'), true);
assert.equal(canAutoReleaseRestriction('project_terminated'), false);
const multiReason = [
  { status: 'released', restrictionYear: 2027, triggerReason: 'missing_required_material' },
  { status: 'active', restrictionYear: 2027, triggerReason: 'project_terminated' }
];
assert.equal(hasActiveRestrictionForYear(multiReason, 2027), true);
assert.equal(hasActiveRestrictionForYear(multiReason, 2028), false);

const states = [
  [{ isApplicable: false }, 'not_applicable'],
  [{ isApplicable: true, latestReviewStatus: 'approved', effectiveRequired: true }, 'formal'],
  [{ isApplicable: true, effectiveRequired: true }, 'required_missing'],
  [{ isApplicable: true, effectiveRequired: true, latestSubmissionId: 1, latestReviewStatus: 'pending' }, 'required_pending'],
  [{ isApplicable: true, effectiveRequired: true, latestSubmissionId: 1, latestReviewStatus: 'returned' }, 'required_returned'],
  [{ isApplicable: true, effectiveRequired: false }, 'optional_skipped'],
  [{ isApplicable: true, effectiveRequired: false, latestSubmissionId: 1, latestReviewStatus: 'pending' }, 'optional_pending'],
  [{ isApplicable: true, effectiveRequired: false, latestSubmissionId: 1, latestReviewStatus: 'returned' }, 'optional_returned']
];
for (const [row, expected] of states) assert.equal(archiveMaterialState(row), expected);

const oldNode = normalizeArchiveTemplateConfig({
  version: 2, projectRootRule: '{项目编号}', defaultFileNameRule: '{材料类别}_{原文件名}',
  nodes: [{ id: 'legacy', type: 'task', materialTaskId: 1, fileTaskId: 2, fileNameRule: '{原文件名}' }]
});
assert.equal(oldNode.nodes[0].requiredMode, 'inherit');
assert.equal(oldNode.nodes[0].requiredReviewNeeded, true);
const optionalNode = normalizeArchiveTemplateConfig({
  version: 2, projectRootRule: '{项目编号}', defaultFileNameRule: '{原文件名}',
  nodes: [{ id: 'optional', type: 'task', materialTaskId: 1, fileTaskId: 2, fileNameRule: '{原文件名}', requiredMode: 'optional' }]
});
assert.equal(optionalNode.nodes[0].requiredMode, 'optional');
assert.equal(safeSpreadsheetText('=HYPERLINK("bad")'), "'=HYPERLINK(\"bad\")");
assert.equal(safeSpreadsheetText('普通中文'), '普通中文');

const sources = Object.fromEntries([
  'projects', 'applications', 'imports'
].map((name) => [name, fs.readFileSync(new URL(`../src/routes/${name}.js`, import.meta.url), 'utf8')]));
const changeSource = fs.readFileSync(new URL('../src/services/projectChangeService.js', import.meta.url), 'utf8');
for (const [name, source] of Object.entries(sources)) {
  assert.match(source, /assertPeopleEligibleForYear/, `${name} must use unified eligibility service`);
}
assert.match(changeSource, /assertPeopleEligibleForYear/);
assert.match(sources.projects, /restrictTerminatedProject/);

const restrictionService = fs.readFileSync(new URL('../src/services/participationEligibilityService.js', import.meta.url), 'utf8');
assert.match(restrictionService, /INSERT IGNORE INTO participation_restrictions/);
assert.match(restrictionService, /trigger_reason = 'missing_required_material'/);
assert.doesNotMatch(restrictionService, /trigger_reason = 'project_terminated'[^;]+auto_released/s);
assert.match(restrictionService, /participation_restriction_events/);

const archiveSource = fs.readFileSync(new URL('../src/services/archiveExportService.js', import.meta.url), 'utf8');
assert.match(archiveSource, /snapshotLocked: true/);
assert.match(archiveSource, /CASE WHEN latest\.review_status = 'approved' THEN latest\.id/);
assert.match(archiveSource, /选填材料状态报告\.xlsx/);
assert.match(archiveSource, /材料适用性明细\.xlsx/);

console.log('final module checks passed');
