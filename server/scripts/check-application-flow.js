import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPLICATION_TRANSITIONS, assertApplicationTransition, normalizeApplicationSchema, validateApplicationData } from '../src/utils/applicationWorkflow.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const migration = fs.readFileSync(path.join(root, 'database', 'migrations', '011_application_approval_loop.sql'), 'utf8');
const route = fs.readFileSync(path.join(root, 'server', 'src', 'routes', 'applications.js'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'server', 'src', 'routes', 'auth.js'), 'utf8');
const projects = fs.readFileSync(path.join(root, 'server', 'src', 'routes', 'projects.js'), 'utf8');
const submissions = fs.readFileSync(path.join(root, 'server', 'src', 'routes', 'submissions.js'), 'utf8');
const imports = fs.readFileSync(path.join(root, 'server', 'src', 'routes', 'imports.js'), 'utf8');
const migrationPreflight = fs.readFileSync(path.join(root, 'server', 'src', 'utils', 'migrationPreflight.js'), 'utf8');
const ownership = fs.readFileSync(path.join(root, 'server', 'src', 'utils', 'projectOwnership.js'), 'utf8');

assert.doesNotThrow(() => assertApplicationTransition('draft', 'submitted'));
assert.doesNotThrow(() => assertApplicationTransition('submitted', 'eligible'));
assert.doesNotThrow(() => assertApplicationTransition('eligible', 'frozen'));
assert.doesNotThrow(() => assertApplicationTransition('frozen', 'school_approved'));
assert.doesNotThrow(() => assertApplicationTransition('school_approved', 'converted'));
assert.throws(() => assertApplicationTransition('draft', 'converted'), /Illegal application status transition/);
assert.equal(APPLICATION_TRANSITIONS.school_rejected.size, 0);

const schema = normalizeApplicationSchema([{ key: 'title', label: '项目名称', type: 'text', required: true }]);
assert.deepEqual(validateApplicationData({ title: '测试项目' }, schema), { title: '测试项目' });
assert.throws(() => validateApplicationData({ title: '' }, schema), /required/);
assert.throws(() => validateApplicationData({ title: 'x', injected: true }, schema), /Unknown application field/);

assert.match(migration, /uk_one_active_application_per_student/);
assert.match(migration, /uk_one_owner_per_project/);
assert.match(migration, /uk_one_project_per_owner/);
assert.match(migration, /application material versions are immutable/);
assert.match(migration, /application audit events are immutable/);
assert.match(migration, /sha256 CHAR\(64\) NOT NULL/);

assert.match(auth, /bcrypt\.hash\(password, 12\)/);
assert.match(auth, /role, status, person_id, password_reset_required[\s\S]*'applicant'/);
assert.match(auth, /registrationIpLimiter/);
assert.match(route, /UPLOAD_TOTAL_SIZE_EXCEEDED/);
assert.match(route, /internal_material_reviewed/);
assert.match(route, /meaning: 'material_eligibility_only'/);
assert.match(route, /FOR UPDATE/);
assert.match(route, /school_approved_and_project_created/);
assert.match(route, /missing_historical/);
assert.match(route, /status = 'frozen'/);
assert.match(route, /report_batch_export_failed_recovered/);
assert.match(route, /const retainedPath = errors\.length \? null : req\.file\.path/);
assert.match(route, /assertFormalProjectOwnership/);
assert.match(projects, /requireRole\('admin', 'project_owner'\)/);
assert.match(projects, /FORMAL_PROJECT_OWNER_REQUIRED/);
assert.match(submissions, /requireRole\('admin', 'project_owner'\)/);
assert.match(imports, /ownershipProjectIdsForPeople/);
assert.match(imports, /assertFormalProjectOwnership\(connection, \[\.\.\.importedProjectIds, \.\.\.ownerProjectsForPeople\]\)/);
assert.match(migrationPreflight, /多负责人项目/);
assert.match(migrationPreflight, /负责人重复/);
assert.match(migrationPreflight, /正式项目无负责人/);
assert.match(ownership, /COUNT\(pp\.id\) <> 1/);

console.log('Application approval loop checks passed.');
