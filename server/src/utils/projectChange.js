import { badRequest } from './errors.js';

export const CHANGE_SCOPE_KEYS = Object.freeze(['members', 'advisors', 'owner']);

function ids(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw badRequest(`${field} 必须是数组`, 'VALIDATION_ERROR');
  const result = [...new Set(value.map(Number))];
  if (result.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw badRequest(`${field} 含无效人员编号`, 'VALIDATION_ERROR');
  }
  return result.sort((a, b) => a - b);
}

export function normalizeChangeScope(value) {
  const source = value || {};
  return {
    members: Boolean(source.members),
    advisors: Boolean(source.advisors),
    owner: Boolean(source.owner)
  };
}

export function normalizeChangePlan(value) {
  const source = value || {};
  const owner = source.ownerChange || null;
  const plan = {
    members: {
      addPersonIds: ids(source.members?.addPersonIds, 'members.addPersonIds'),
      removePersonIds: ids(source.members?.removePersonIds, 'members.removePersonIds')
    },
    advisors: {
      addPersonIds: ids(source.advisors?.addPersonIds, 'advisors.addPersonIds'),
      removePersonIds: ids(source.advisors?.removePersonIds, 'advisors.removePersonIds')
    },
    ownerChange: owner ? {
      newOwnerPersonId: Number(owner.newOwnerPersonId),
      previousOwnerDisposition: owner.previousOwnerDisposition
    } : null
  };
  if (plan.members.addPersonIds.some((id) => plan.members.removePersonIds.includes(id))) {
    throw badRequest('同一成员不能同时新增和移除', 'PROJECT_CHANGE_PLAN_CONFLICT');
  }
  if (plan.advisors.addPersonIds.some((id) => plan.advisors.removePersonIds.includes(id))) {
    throw badRequest('同一导师不能同时新增和移除', 'PROJECT_CHANGE_PLAN_CONFLICT');
  }
  if (owner && (!Number.isSafeInteger(plan.ownerChange.newOwnerPersonId) || plan.ownerChange.newOwnerPersonId <= 0)) {
    throw badRequest('请选择有效的新负责人', 'VALIDATION_ERROR');
  }
  if (owner && !['member', 'exit'].includes(plan.ownerChange.previousOwnerDisposition)) {
    throw badRequest('请选择原负责人转为普通成员或退出项目', 'VALIDATION_ERROR');
  }
  return plan;
}

export function assertPlanWithinScope(plan, scopeValue, { allowEmpty = false } = {}) {
  const scope = normalizeChangeScope(scopeValue);
  if (!scope.members && (plan.members.addPersonIds.length || plan.members.removePersonIds.length)) {
    throw badRequest('该任务不允许变更项目成员', 'PROJECT_CHANGE_SCOPE_DENIED');
  }
  if (!scope.advisors && (plan.advisors.addPersonIds.length || plan.advisors.removePersonIds.length)) {
    throw badRequest('该任务不允许变更指导教师', 'PROJECT_CHANGE_SCOPE_DENIED');
  }
  if (!scope.owner && plan.ownerChange) {
    throw badRequest('该任务不允许更换项目负责人', 'PROJECT_CHANGE_SCOPE_DENIED');
  }
  if (!allowEmpty && !plan.ownerChange && !plan.members.addPersonIds.length && !plan.members.removePersonIds.length
    && !plan.advisors.addPersonIds.length && !plan.advisors.removePersonIds.length) {
    throw badRequest('请至少填写一项拟变更内容', 'PROJECT_CHANGE_EMPTY');
  }
  return scope;
}

export function changeSummary(plan) {
  const items = [];
  if (plan.members.addPersonIds.length) items.push(`新增成员 ${plan.members.addPersonIds.length} 人`);
  if (plan.members.removePersonIds.length) items.push(`移除成员 ${plan.members.removePersonIds.length} 人`);
  if (plan.advisors.addPersonIds.length) items.push(`新增导师 ${plan.advisors.addPersonIds.length} 人`);
  if (plan.advisors.removePersonIds.length) items.push(`移除导师 ${plan.advisors.removePersonIds.length} 人`);
  if (plan.ownerChange) items.push(`更换负责人（原负责人${plan.ownerChange.previousOwnerDisposition === 'member' ? '转成员' : '退出'}）`);
  return items.join('；') || '无变更';
}

// 统一资格校验入口：后续黑名单规则应追加到此数组，不要散落在路由中。
export const projectOwnerQualificationChecks = Object.freeze([
  'student', 'person_enabled', 'registered_account', 'account_enabled', 'single_formal_project_owner'
]);
