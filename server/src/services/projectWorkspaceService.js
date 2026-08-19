import { notFound } from '../utils/errors.js';

const jsonValue = (value, fallback) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};

const dateValue = (value) => value ? new Date(value).toISOString() : null;

export function projectFieldChanges(before, after) {
  const fields = [
    'projectYear', 'projectGroup', 'projectCode', 'title', 'category',
    'approvalDate', 'approvalType', 'approvalBatch', 'status', 'remark'
  ];
  return fields.flatMap((field) => {
    let beforeValue = before?.[field] ?? null;
    let afterValue = after?.[field] ?? null;
    if (field === 'approvalDate') {
      const toShanghaiDate = (value) => value instanceof Date
        ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
        : value;
      beforeValue = toShanghaiDate(beforeValue);
      afterValue = toShanghaiDate(afterValue);
    }
    return String(beforeValue ?? '') === String(afterValue ?? '')
      ? []
      : [{ field, before: beforeValue, after: afterValue }];
  });
}

export function participationSnapshot(rows) {
  return (rows || []).map((row) => ({
    participationId: Number(row.id),
    personId: Number(row.personId ?? row.person_id),
    role: row.role,
    name: row.name,
    identifier: row.identifier ?? null,
    organization: row.organization ?? null,
    joinedAt: row.joinedAt ?? row.joined_at ?? null,
    remark: row.remark ?? null
  })).sort((a, b) => `${a.role}:${a.personId}`.localeCompare(`${b.role}:${b.personId}`));
}

export function timelineState(event) {
  if (event.state) return event.state;
  if (event.eventType === 'project_status_changed' && event.changes?.some((change) => change.field === 'status' && change.after === 'stopped')) return 'exception';
  if (event.eventType === 'material_returned' || event.eventType === 'application_returned' || event.eventType === 'project_stopped') return 'exception';
  if (event.eventType === 'material_submitted' && event.reviewStatus === 'pending') return 'current';
  return 'completed';
}

function applicationEventPresentation(eventType, payload) {
  const summaries = {
    application_created: '创建立项申请',
    application_edited: '修改立项申请',
    application_material_uploaded: '上传立项申请材料',
    application_submitted: payload.submissionVersion ? `提交第 ${payload.submissionVersion} 版立项申请` : '提交立项申请',
    application_withdrawn: `撤回立项申请${payload.reason ? `：${payload.reason}` : ''}`,
    report_batch_frozen: `申请已冻结并报送学校${payload.exportNo ? `（${payload.exportNo}）` : ''}`,
    report_batch_recalled: `撤回学校报送${payload.reason ? `：${payload.reason}` : ''}`,
    historical_project_linked: '历史正式项目与立项来源建立关联',
    school_approved_and_project_created: '学校审核通过并建立正式项目',
    school_rejected: `学校审核未通过${payload.remark ? `：${payload.remark}` : ''}`
  };
  if (eventType === 'internal_material_reviewed') {
    return {
      summary: payload.result === 'returned' ? `校内材料审核退回${payload.reason ? `：${payload.reason}` : ''}` : '校内材料审核通过',
      state: payload.result === 'returned' ? 'exception' : 'completed'
    };
  }
  const exceptionTypes = new Set(['application_withdrawn', 'report_batch_recalled', 'school_rejected', 'application_returned']);
  return { summary: summaries[eventType] || payload.summary || payload.reason || eventType, state: exceptionTypes.has(eventType) ? 'exception' : 'completed' };
}

export function buildProjectTimeline({ project, source, auditEvents = [], applicationEvents = [], importEvents = [], submissions = [] }) {
  const events = [];
  if (project?.createdAt && !auditEvents.some((event) => event.eventType === 'project_created')) {
    events.push({
      id: `project-created-${project.id}`,
      eventType: source ? 'project_established' : 'project_created',
      eventCategory: 'project',
      occurredAt: dateValue(project.createdAt),
      actor: source?.sourceCreator || null,
      sourceModule: source ? '立项流程' : '项目管理',
      summary: source ? '正式项目建立' : '项目记录创建',
      state: 'completed',
      legacyDerived: true
    });
  }
  if (source?.batchName) {
    events.push({
      id: `approval-source-${project.id}`,
      eventType: source.sourceType === 'historical_official_list' ? 'historical_approval_imported' : 'application_approved',
      eventCategory: 'application',
      occurredAt: dateValue(source.sourceCreatedAt || project.approvalDate || project.createdAt),
      actor: source.sourceCreator || null,
      sourceModule: '立项流程',
      summary: `${source.approvalRound === 'supplement' ? '补充' : '首次'}立项 · ${source.batchName}`,
      state: 'completed',
      legacyDerived: true
    });
  }
  for (const row of auditEvents) {
    const changes = jsonValue(row.fieldChanges, []);
    const payload = jsonValue(row.eventPayload, {});
    events.push({
      id: `project-audit-${row.id}`,
      eventType: row.eventType,
      eventCategory: row.eventType === 'participations_changed' ? 'participation' : 'project',
      occurredAt: dateValue(row.createdAt),
      actor: row.actorName || null,
      sourceModule: row.sourceModule,
      summary: payload.summary || (row.eventType === 'participations_changed' ? '项目人员关系发生变化' : '项目字段已修改'),
      changes,
      beforeSnapshot: payload.beforeSnapshot || null,
      afterSnapshot: payload.afterSnapshot || null,
      state: timelineState({ eventType: row.eventType, changes }),
      legacyDerived: false
    });
  }
  for (const row of applicationEvents) {
    const payload = jsonValue(row.eventPayload, {});
    const presentation = applicationEventPresentation(row.eventType, payload);
    events.push({
      id: `application-audit-${row.id}`,
      eventType: row.eventType,
      eventCategory: 'application',
      occurredAt: dateValue(row.createdAt),
      actor: row.actorName || null,
      sourceModule: '立项流程',
      summary: presentation.summary,
      state: presentation.state,
      legacyDerived: false
    });
  }
  for (const row of importEvents) {
    events.push({
      id: `import-${row.id}`,
      eventType: row.entityType === 'participation' ? 'participations_imported' : 'project_imported',
      eventCategory: row.entityType === 'participation' ? 'participation' : 'import',
      occurredAt: dateValue(row.createdAt),
      actor: row.actorName || null,
      sourceModule: '数据导入',
      summary: row.message || `${row.operationType === 'create' ? '导入创建' : '导入更新'}${row.entityType === 'participation' ? '人员关系' : '项目'}`,
      beforeSnapshot: jsonValue(row.beforeSnapshot, null),
      afterSnapshot: jsonValue(row.afterSnapshot, null),
      state: row.status === 'failed' || row.status === 'conflict' ? 'exception' : 'completed',
      legacyDerived: false
    });
  }
  for (const row of submissions) {
    events.push({
      id: `submission-${row.id}`,
      eventType: 'material_submitted',
      eventCategory: 'material',
      occurredAt: dateValue(row.submittedAt || row.createdAt),
      actor: row.submitterName || null,
      sourceModule: '材料提交',
      summary: `提交“${row.taskName} / ${row.categoryName}”第 ${row.version} 版`,
      reviewStatus: row.reviewStatus,
      state: row.reviewStatus === 'pending' ? 'current' : 'completed',
      legacyDerived: true
    });
    if (row.reviewedAt) {
      events.push({
        id: `submission-review-${row.id}`,
        eventType: row.reviewStatus === 'returned' ? 'material_returned' : 'material_approved',
        eventCategory: 'material',
        occurredAt: dateValue(row.reviewedAt),
        actor: row.reviewerName || null,
        sourceModule: '材料审核',
        summary: row.reviewStatus === 'returned' ? `退回“${row.categoryName}”：${row.returnReason || '未填写原因'}` : `通过“${row.categoryName}”审核`,
        state: row.reviewStatus === 'returned' ? 'exception' : 'completed',
        legacyDerived: true
      });
    }
  }
  return events.sort((a, b) => new Date(b.occurredAt || 0) - new Date(a.occurredAt || 0));
}

export async function assertProjectWorkspaceAccess(connection, projectId, user) {
  const params = [projectId];
  let ownership = '';
  if (user.role === 'project_owner') {
    ownership = `AND EXISTS (
      SELECT 1 FROM project_participations mine
      WHERE mine.project_id = p.id AND mine.person_id = ? AND mine.role = 'owner' AND mine.deleted_at IS NULL
    )`;
    params.push(user.personId || 0);
  }
  const [[project]] = await connection.execute(
    `SELECT p.id FROM projects p WHERE p.id = ? AND p.deleted_at IS NULL ${ownership} LIMIT 1`,
    params
  );
  if (!project) throw notFound('Project not found');
  return Number(project.id);
}

function groupMaterials(taskRows, submissionRows, fileRows) {
  const tasks = new Map();
  for (const row of taskRows) {
    const task = tasks.get(Number(row.taskId)) || {
      taskId: Number(row.taskId), taskName: row.taskName, taskDescription: row.taskDescription,
      scopeType: row.scopeType, scopeYear: row.scopeYear, scopeGroup: row.scopeGroup,
      deadlineAt: row.deadlineAt, taskStatus: row.taskStatus, categories: []
    };
    task.categories.push({
      categoryId: Number(row.categoryId), categoryName: row.categoryName,
      taskDescription: row.categoryDescription, isRequired: Boolean(row.isRequired), versions: []
    });
    tasks.set(task.taskId, task);
  }
  const categoryMap = new Map([...tasks.values()].flatMap((task) => task.categories.map((category) => [category.categoryId, category])));
  const fileMap = new Map();
  for (const file of fileRows) {
    const list = fileMap.get(Number(file.submissionId)) || [];
    list.push({ id: Number(file.id), originalName: file.originalName, fileSize: Number(file.fileSize), mimeType: file.mimeType, createdAt: file.createdAt });
    fileMap.set(Number(file.submissionId), list);
  }
  for (const row of submissionRows) {
    categoryMap.get(Number(row.categoryId))?.versions.push({ ...row, id: Number(row.id), version: Number(row.version), files: fileMap.get(Number(row.id)) || [] });
  }
  return [...tasks.values()];
}

export async function loadProjectWorkspace(connection, projectId, user) {
  await assertProjectWorkspaceAccess(connection, projectId, user);
  const [[project]] = await connection.execute(
    `SELECT p.id, p.project_year AS projectYear, p.project_group AS projectGroup, p.project_code AS projectCode,
            p.title, p.category, p.approval_date AS approvalDate, p.approval_type AS approvalType,
            p.approval_batch AS approvalBatch, p.status, p.remark, p.created_at AS createdAt, p.updated_at AS updatedAt
     FROM projects p WHERE p.id = ? AND p.deleted_at IS NULL`, [projectId]
  );
  const [[source]] = await connection.execute(
    `SELECT pas.source_type AS sourceType, pas.historical_material_status AS historicalMaterialStatus,
            pas.created_at AS sourceCreatedAt, creator.display_name AS sourceCreator,
            ab.id AS batchId, ab.batch_name AS batchName, ab.approval_round AS approvalRound, ab.status AS batchStatus,
            pa.id AS applicationId, pa.status AS applicationStatus, pa.submitted_at AS submittedAt,
            pa.internal_reviewed_at AS internalReviewedAt, pa.internal_review_reason AS internalReviewReason,
            pa.frozen_at AS reportedAt, pa.school_result_at AS schoolResultAt, pa.school_result_remark AS schoolResultRemark
     FROM project_approval_sources pas
     JOIN application_batches ab ON ab.id = pas.application_batch_id
     LEFT JOIN project_applications pa ON pa.id = pas.project_application_id
     LEFT JOIN users creator ON creator.id = pas.created_by
     WHERE pas.project_id = ? LIMIT 1`, [projectId]
  );
  const [participations] = await connection.execute(
    `SELECT pp.id, pp.role, pp.is_primary_owner AS isPrimaryOwner, pp.joined_at AS joinedAt, pp.remark,
            pe.id AS personId, pe.person_type AS personType, pe.name,
            COALESCE(pe.student_no, pe.teacher_no) AS identifier,
            COALESCE(pe.college, pe.unit) AS organization, pe.phone, pe.qq, pe.email, pe.title
     FROM project_participations pp JOIN people pe ON pe.id = pp.person_id AND pe.deleted_at IS NULL
     WHERE pp.project_id = ? AND pp.deleted_at IS NULL
     ORDER BY FIELD(pp.role, 'owner', 'member', 'advisor'), pe.name`, [projectId]
  );
  const [taskRows] = await connection.execute(
    `SELECT mt.id AS taskId, mt.task_name AS taskName, mt.task_description AS taskDescription,
            mt.project_scope_type AS scopeType, mt.project_year AS scopeYear, mt.project_group AS scopeGroup,
            mt.deadline_at AS deadlineAt, mt.status AS taskStatus,
            mc.id AS categoryId, mc.category_name AS categoryName, mc.task_description AS categoryDescription,
            mc.is_required AS isRequired
     FROM projects p
     JOIN material_tasks mt ON mt.deleted_at IS NULL ${user.role === 'project_owner' ? "AND mt.status IN ('published', 'closed')" : ''} AND (
       mt.project_scope_type = 'all' OR (mt.project_scope_type = 'year' AND mt.project_year = p.project_year)
       OR (mt.project_scope_type = 'group' AND mt.project_group = p.project_group)
       OR (mt.project_scope_type = 'custom' AND EXISTS (SELECT 1 FROM material_task_projects mtp WHERE mtp.material_task_id = mt.id AND mtp.project_id = p.id))
     )
     JOIN material_categories mc ON mc.material_task_id = mt.id AND mc.deleted_at IS NULL
     WHERE p.id = ? ORDER BY mt.created_at, mc.sort_order, mc.id`, [projectId]
  );
  const [submissionRows] = await connection.execute(
    `SELECT ms.id, ms.material_category_id AS categoryId, ms.submission_status AS submissionStatus,
            ms.review_status AS reviewStatus, ms.return_reason AS returnReason, ms.submitted_at AS submittedAt,
            ms.reviewed_at AS reviewedAt, ms.created_at AS createdAt,
            submitter.display_name AS submitterName, reviewer.display_name AS reviewerName,
            mt.task_name AS taskName, mc.category_name AS categoryName,
            ROW_NUMBER() OVER (PARTITION BY ms.material_task_id, ms.material_category_id ORDER BY ms.id) AS version
     FROM material_submissions ms
     JOIN material_tasks mt ON mt.id = ms.material_task_id
     JOIN material_categories mc ON mc.id = ms.material_category_id
     JOIN users submitter ON submitter.id = ms.submitter_user_id
     LEFT JOIN users reviewer ON reviewer.id = ms.reviewed_by
     WHERE ms.project_id = ? AND ms.deleted_at IS NULL ORDER BY ms.id DESC`, [projectId]
  );
  const submissionIds = submissionRows.map((row) => Number(row.id));
  let fileRows = [];
  if (submissionIds.length) {
    [fileRows] = await connection.execute(
      `SELECT id, submission_id AS submissionId, original_name AS originalName, file_size AS fileSize,
              mime_type AS mimeType, created_at AS createdAt
       FROM material_files WHERE deleted_at IS NULL AND submission_id IN (${submissionIds.map(() => '?').join(',')}) ORDER BY id`,
      submissionIds
    );
  }
  const [auditEvents] = await connection.execute(
    `SELECT pae.id, pae.event_type AS eventType, pae.source_module AS sourceModule,
            pae.field_changes AS fieldChanges, pae.event_payload AS eventPayload, pae.created_at AS createdAt,
            u.display_name AS actorName
     FROM project_audit_events pae LEFT JOIN users u ON u.id = pae.actor_user_id
     WHERE pae.project_id = ? ORDER BY pae.created_at DESC, pae.id DESC`, [projectId]
  );
  const [applicationEvents] = await connection.execute(
    `SELECT aae.id, aae.event_type AS eventType, aae.event_payload AS eventPayload, aae.created_at AS createdAt,
            u.display_name AS actorName
     FROM application_audit_events aae
     LEFT JOIN users u ON u.id = aae.actor_user_id
     LEFT JOIN project_approval_sources pas ON pas.project_application_id = aae.project_application_id
     WHERE aae.project_id = ? OR pas.project_id = ? ORDER BY aae.created_at DESC`, [projectId, projectId]
  );
  const [importEvents] = await connection.execute(
    `SELECT ibr.id, ibr.entity_type AS entityType, ibr.operation_type AS operationType, ibr.status,
            ibr.before_snapshot AS beforeSnapshot, ibr.after_snapshot AS afterSnapshot, ibr.message,
            ibr.created_at AS createdAt, u.display_name AS actorName
     FROM import_batch_records ibr JOIN import_batches ib ON ib.id = ibr.batch_id
     LEFT JOIN users u ON u.id = COALESCE(ib.committed_by, ib.created_by)
     WHERE (ibr.entity_type = 'project' AND ibr.target_id = ?)
        OR (ibr.entity_type = 'participation' AND (
          JSON_UNQUOTE(JSON_EXTRACT(ibr.before_snapshot, '$.project_id')) = CAST(? AS CHAR)
          OR JSON_UNQUOTE(JSON_EXTRACT(ibr.after_snapshot, '$.project_id')) = CAST(? AS CHAR)
        ))
     ORDER BY ibr.created_at DESC`, [projectId, projectId, projectId]
  );
  const materials = groupMaterials(taskRows, submissionRows, fileRows);
  const timeline = buildProjectTimeline({ project, source, auditEvents, applicationEvents, importEvents, submissions: submissionRows });
  const completedMaterials = submissionRows.filter((row) => row.reviewStatus === 'approved').length;
  return {
    project,
    source: source || null,
    participations,
    materials,
    timeline,
    capabilities: { canEditProject: user.role === 'admin', canEditParticipations: user.role === 'admin', isReadOnly: user.role !== 'admin' },
    summary: {
      participantCount: participations.length,
      materialTaskCount: new Set(taskRows.map((row) => Number(row.taskId))).size,
      submissionVersionCount: submissionRows.length,
      approvedSubmissionCount: completedMaterials,
      exceptionCount: timeline.filter((event) => event.state === 'exception').length
    }
  };
}

export async function writeProjectAudit(connection, { projectId, eventType, actorUserId, sourceModule = '项目管理', changes = [], payload = {} }) {
  await connection.execute(
    `INSERT INTO project_audit_events
     (project_id, event_type, actor_user_id, source_module, field_changes, event_payload)
     VALUES (?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON))`,
    [projectId, eventType, actorUserId || null, sourceModule, JSON.stringify(changes), JSON.stringify(payload)]
  );
}
