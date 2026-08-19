import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_PERMISSION_KEYS,
  hasAdminPermission,
  normalizePermissionKeys,
  normalizeStudentNumber
} from '../src/utils/adminPermissions.js';

const __filename = fileURLToPath(import.meta.url);
const serverRoot = path.resolve(path.dirname(__filename), '..');
const projectRoot = path.resolve(serverRoot, '..');
const read = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

assert.equal(normalizeStudentNumber('  ab-2026001  '), 'AB-2026001');
assert.equal(normalizeStudentNumber(null), '');
assert.deepEqual(
  normalizePermissionKeys(['material_review', 'project_management', 'material_review']),
  ['project_management', 'material_review']
);
assert.throws(() => normalizePermissionKeys(['unknown_permission']), /存在无效权限/);
assert.equal(hasAdminPermission({ role: 'admin', adminLevel: 'super', permissions: [] }, 'data_import'), true);
assert.equal(hasAdminPermission({ role: 'admin', adminLevel: 'limited', permissions: ['data_import'] }, 'data_import'), true);
assert.equal(hasAdminPermission({ role: 'admin', adminLevel: 'limited', permissions: [] }, 'data_import'), false);
assert.equal(hasAdminPermission({ role: 'project_owner', permissions: ['data_import'] }, 'data_import'), false);

const migration = read('database/migrations/012_admin_permissions_and_student_accounts.sql');
assert.match(migration, /uk_users_single_super_admin/);
assert.match(migration, /trg_users_preserve_super_admin/);
assert.match(migration, /permissions may only be assigned to limited administrators/);
for (const permissionKey of ADMIN_PERMISSION_KEYS) assert.match(migration, new RegExp(`'${permissionKey}'`));

const auth = read('server/src/routes/auth.js');
const registration = auth.slice(auth.indexOf("router.post('/register'"), auth.indexOf('function publicUser'));
assert.doesNotMatch(registration, /req\.body\?\.username/);
assert.match(registration, /normalizeStudentNumber/);
assert.match(registration, /WHERE student_no = \?/);
assert.match(registration, /PERSON_ACCOUNT_ALREADY_BOUND/);
assert.match(registration, /STUDENT_ALREADY_PROJECT_OWNER/);
assert.match(registration, /PERSON_INFO_MISMATCH/);
assert.match(registration, /STUDENT_RECORD_ARCHIVED/);
assert.match(registration, /\[studentNo, person \? person\.name : name, passwordHash, personId\]/);

const accounts = read('server/src/routes/accounts.js');
assert.match(accounts, /router\.use\(requireAuth, requireRole\('admin'\), requireSuperAdmin\)/);
assert.match(accounts, /adminLevel = 'limited'/);
assert.match(accounts, /normalizeStudentNumber\(person\.student_no\)/);
assert.match(accounts, /PERSON_ACCOUNT_ALREADY_BOUND/);
assert.match(accounts, /admin_permission_audit_events/);
assert.match(read('server/scripts/reset-admin-password.js'), /admin_level = 'super'/);

const backendBindings = {
  project_management: ['server/src/routes/projects.js'],
  people_management: ['server/src/routes/people.js'],
  data_import: ['server/src/routes/imports.js', 'server/src/routes/importTemplates.js'],
  material_task: ['server/src/routes/materialTasks.js', 'server/src/routes/uploads.js'],
  material_review: ['server/src/routes/submissions.js'],
  application_management: ['server/src/routes/applications.js'],
  archive_management: ['server/src/routes/archiveTemplates.js', 'server/src/routes/archiveExports.js'],
  report_management: ['server/src/routes/reportDesigns.js'],
  participation_rules: ['server/src/routes/participationRules.js']
};
for (const [permissionKey, files] of Object.entries(backendBindings)) {
  for (const file of files) assert.ok(read(file).includes(`'${permissionKey}'`), `${file} lacks ${permissionKey}`);
}

const router = read('code/kexie_vue/src/router/index.js');
const menu = read('code/kexie_vue/src/views/admin/AdminLayout.vue');
for (const permissionKey of ADMIN_PERMISSION_KEYS) {
  assert.ok(router.includes(`permission: '${permissionKey}'`), `router lacks ${permissionKey}`);
  assert.ok(menu.includes(`permission: '${permissionKey}'`), `menu lacks ${permissionKey}`);
}
assert.match(router, /superAdmin: true/);
assert.match(menu, /superAdmin: true/);
assert.match(router, /authStore\.hasPermission\(to\.meta\.permission\)/);
assert.match(menu, /authStore\.hasPermission\(item\.permission\)/);

const registerView = read('code/kexie_vue/src/views/RegisterView.vue');
assert.doesNotMatch(registerView, /登录账号" prop="username/);
assert.match(registerView, /学号将作为登录账号/);
assert.match(read('code/kexie_vue/src/views/LoginView.vue'), /账号\/学号/);

console.log(JSON.stringify({
  verified: [
    'student number normalization and forced username',
    'existing-person reuse and duplicate-account guards',
    'single-super database and service guards',
    'limited-administrator permission decisions',
    'backend module permission bindings',
    'frontend route and menu permission consistency',
    'material_review assignment boundary',
    'legacy roles remain unchanged'
  ]
}, null, 2));
