export const ownerStats = [
  { label: '负责项目', value: 2 },
  { label: '待提交材料', value: 3 },
  { label: '退回待处理', value: 1 },
  { label: '临近截止', value: 2 },
]

export const ownerTasks = [
  {
    name: '中期检查材料',
    project: '智能实验室预约与耗材管理系统',
    deadline: '2026-08-20',
    status: '未提交',
  },
  {
    name: '研究日志汇总',
    project: '校园低碳行为数据分析',
    deadline: '2026-08-18',
    status: '退回',
    reason: '缺少指导老师签字页',
  },
  {
    name: '阶段报销凭证',
    project: '智能实验室预约与耗材管理系统',
    deadline: '2026-09-05',
    status: '已提交',
  },
]

export const ownerProjects = [
  {
    code: 'CX2026-018',
    name: '智能实验室预约与耗材管理系统',
    group: '信息技术组',
    category: '创新训练',
    status: '进行中',
    mentor: '周老师',
  },
  {
    code: 'CX2026-043',
    name: '校园低碳行为数据分析',
    group: '社会调查组',
    category: '创业训练',
    status: '阶段检查',
    mentor: '刘老师',
  },
]

export const projectContacts = [
  {
    name: '李明',
    role: '项目负责人',
    org: '计算机学院',
    phone: '13800000001',
    qq: '100001',
    email: 'liming@example.edu.cn',
  },
  {
    name: '王珊',
    role: '项目成员',
    org: '计算机学院',
    phone: '13800000002',
    qq: '100002',
    email: 'wangshan@example.edu.cn',
  },
  {
    name: '周老师',
    role: '指导老师',
    org: '信息工程系',
    phone: '13800000003',
    qq: '-',
    email: 'zhou@example.edu.cn',
  },
]

export const adminMetrics = [
  { label: '项目总数', value: 128 },
  { label: '人员记录', value: 462 },
  { label: '待审核材料', value: 19 },
  { label: '可导出任务', value: 6 },
]

export const adminProjects = [
  {
    year: '2026',
    group: '信息技术组',
    code: 'CX2026-018',
    name: '智能实验室预约与耗材管理系统',
    owner: '李明',
    status: '进行中',
  },
  {
    year: '2026',
    group: '社会调查组',
    code: 'CX2026-043',
    name: '校园低碳行为数据分析',
    owner: '赵雨',
    status: '阶段检查',
  },
  {
    year: '2025',
    group: '生命科学组',
    code: 'CX2025-091',
    name: '校园植物多样性图谱',
    owner: '陈晨',
    status: '已结项',
  },
]

export const people = [
  {
    name: '李明',
    type: '学生',
    identifier: '2026123001',
    org: '计算机学院',
    phone: '13800000001',
    status: '启用',
  },
  {
    name: '赵雨',
    type: '学生',
    identifier: '2026123008',
    org: '管理学院',
    phone: '13800000008',
    status: '启用',
  },
  {
    name: '周老师',
    type: '指导老师',
    identifier: 'T20260018',
    org: '信息工程系',
    phone: '13800000003',
    status: '启用',
  },
]

export const accounts = [
  { name: '李明', role: '项目负责人', account: '2026123001', status: '启用' },
  { name: '周老师', role: '只读查看人员', account: 'T20260018', status: '启用' },
  { name: '科研秘书', role: '管理员', account: 'admin', status: '启用' },
]

export const materialTasks = [
  {
    name: '中期检查材料',
    scope: '2026 年全部在研项目',
    categories: '报告书、研究日志、签字页',
    deadline: '2026-08-20',
    status: '收集中',
  },
  {
    name: '阶段报销凭证',
    scope: '已通过中期检查项目',
    categories: '发票、报销汇总表',
    deadline: '2026-09-05',
    status: '未开始',
  },
]

export const reviewItems = [
  {
    project: '校园低碳行为数据分析',
    material: '研究日志汇总',
    submitter: '赵雨',
    submittedAt: '2026-08-04 16:30',
    status: '待审核',
  },
  {
    project: '智能实验室预约与耗材管理系统',
    material: '阶段报销凭证',
    submitter: '李明',
    submittedAt: '2026-08-05 09:12',
    status: '待审核',
  },
]

export const archiveTemplates = [
  {
    name: '年度-组别-项目编号模板',
    rule: '年度 / 组别 / 项目编号-作品名称 / 材料类别',
    updatedAt: '2026-08-01',
    status: '启用',
  },
  {
    name: '结项材料快速导出模板',
    rule: '年度 / 结项批次 / 项目编号-负责人',
    updatedAt: '2026-07-22',
    status: '草稿',
  },
]

export const exportRecords = [
  {
    batch: 'EXP-20260805-001',
    template: '年度-组别-项目编号模板',
    scope: '2026 年中期检查',
    operator: '科研秘书',
    exportedAt: '2026-08-05 10:10',
  },
]

export const participationRules = [
  { name: '项目负责人上限', value: '每人最多 1 个项目', status: '启用' },
  { name: '项目成员上限', value: '每人最多 2 个项目', status: '启用' },
  { name: '指导老师关联', value: '每个项目至少 1 名指导老师', status: '启用' },
]
