<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">我的待办</h2>
        <p class="page-desc">聚合展示负责人最需要处理的项目材料状态。</p>
      </div>
      <el-button type="primary" @click="$router.push('/owner/submissions')">
        <el-icon><Upload /></el-icon>
        提交材料
      </el-button>
    </div>

    <section class="metric-grid section">
      <article v-for="item in ownerStats" :key="item.label" class="metric">
        <p class="metric-label">{{ item.label }}</p>
        <p class="metric-value">{{ item.value }}</p>
      </article>
    </section>

    <section class="work-grid">
      <div class="panel">
        <div class="toolbar">
          <strong>材料任务</strong>
          <el-button text @click="$router.push('/owner/submissions')">查看全部</el-button>
        </div>
        <div class="panel-body">
          <div class="status-stack">
            <div v-for="task in ownerTasks" :key="task.name" class="status-item">
              <div>
                <p class="status-title">{{ task.name }}</p>
                <p class="status-desc">{{ task.project }} · 截止 {{ task.deadline }}</p>
                <p v-if="task.reason" class="status-desc">退回原因：{{ task.reason }}</p>
              </div>
              <el-tag :type="statusType(task.status)">{{ task.status }}</el-tag>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="toolbar">
          <strong>项目联系人</strong>
          <el-button text @click="$router.push('/owner/contacts')">通讯录</el-button>
        </div>
        <div class="panel-body">
          <div class="status-stack">
            <div v-for="person in projectContacts.slice(0, 3)" :key="person.name" class="status-item">
              <div>
                <p class="status-title">{{ person.name }}</p>
                <p class="status-desc">{{ person.role }} · {{ person.org }}</p>
              </div>
              <el-tag effect="plain">{{ person.phone }}</el-tag>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ownerStats, ownerTasks, projectContacts } from '../../data/mock'

function statusType(status) {
  if (status === '已提交') return 'success'
  if (status === '退回') return 'danger'
  return 'warning'
}
</script>
