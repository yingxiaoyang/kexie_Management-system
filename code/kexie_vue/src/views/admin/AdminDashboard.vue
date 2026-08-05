<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">管理总览</h2>
        <p class="page-desc">汇总项目、人员、材料审核和归档导出状态。</p>
      </div>
      <el-button type="primary" @click="$router.push('/admin/tasks')">
        <el-icon><Plus /></el-icon>
        新建材料任务
      </el-button>
    </div>

    <section class="metric-grid section">
      <article v-for="item in adminMetrics" :key="item.label" class="metric">
        <p class="metric-label">{{ item.label }}</p>
        <p class="metric-value">{{ item.value }}</p>
      </article>
    </section>

    <section class="work-grid">
      <div class="panel">
        <div class="toolbar">
          <strong>待审核材料</strong>
          <el-button text @click="$router.push('/admin/reviews')">进入审核</el-button>
        </div>
        <el-table :data="reviewItems" style="width: 100%">
          <el-table-column prop="project" label="项目" min-width="220" show-overflow-tooltip />
          <el-table-column prop="material" label="材料" width="150" />
          <el-table-column prop="submitter" label="提交人" width="100" />
          <el-table-column prop="submittedAt" label="提交时间" width="160" />
        </el-table>
      </div>

      <div class="panel">
        <div class="toolbar">
          <strong>归档模板</strong>
          <el-button text @click="$router.push('/admin/archive-templates')">配置</el-button>
        </div>
        <div class="panel-body">
          <div class="status-stack">
            <div v-for="template in archiveTemplates" :key="template.name" class="status-item">
              <div>
                <p class="status-title">{{ template.name }}</p>
                <p class="status-desc">{{ template.rule }}</p>
              </div>
              <el-tag :type="template.status === '启用' ? 'success' : 'info'">
                {{ template.status }}
              </el-tag>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { adminMetrics, archiveTemplates, reviewItems } from '../../data/mock'
</script>
