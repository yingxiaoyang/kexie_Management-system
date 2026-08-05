<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">归档模板</h2>
        <p class="page-desc">用目录层级和文件命名规则定义材料整理包结构。</p>
      </div>
      <el-button type="primary" @click="dialogVisible = true">
        <el-icon><Plus /></el-icon>
        新建模板
      </el-button>
    </div>

    <div class="panel">
      <el-table :data="archiveTemplates" style="width: 100%">
        <el-table-column prop="name" label="模板名称" min-width="180" />
        <el-table-column prop="rule" label="目录规则" min-width="260" show-overflow-tooltip />
        <el-table-column prop="updatedAt" label="更新时间" width="130" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === '启用' ? 'success' : 'info'">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default>
            <el-button text>编辑</el-button>
            <el-button text>预览</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" title="归档模板表单" width="680px">
      <el-form label-width="108px">
        <el-form-item label="模板名称">
          <el-input />
        </el-form-item>
        <el-form-item label="目录层级">
          <el-select
            model-value="year-group-project-category"
            placeholder="选择目录层级"
            style="width: 100%"
          >
            <el-option label="年度 / 组别 / 项目编号-作品名称 / 材料类别" value="year-group-project-category" />
            <el-option label="年度 / 结项批次 / 项目编号-负责人" value="year-batch-owner" />
          </el-select>
        </el-form-item>
        <el-form-item label="文件命名">
          <el-input placeholder="项目编号_作品名称_负责人_材料名称" />
        </el-form-item>
      </el-form>
      <p class="table-note">
        后续可在这里扩展为拖拽式目录树，当前先固定 Element Plus 表单承载配置。
      </p>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="dialogVisible = false">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { archiveTemplates } from '../../data/mock'

const dialogVisible = ref(false)
</script>
