<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">材料任务</h2>
        <p class="page-desc">管理员发布材料清单、适用范围、截止时间、格式和大小限制。</p>
      </div>
      <el-button type="primary" @click="dialogVisible = true">
        <el-icon><Plus /></el-icon>
        新建任务
      </el-button>
    </div>

    <div class="panel">
      <div class="toolbar">
        <div class="filters">
          <el-input placeholder="搜索任务名称或适用范围" clearable>
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <el-select model-value="" placeholder="任务状态" clearable style="width: 150px">
            <el-option label="未开始" value="未开始" />
            <el-option label="收集中" value="收集中" />
            <el-option label="已截止" value="已截止" />
          </el-select>
        </div>
      </div>
      <el-table :data="materialTasks" style="width: 100%">
        <el-table-column prop="name" label="任务名称" min-width="160" />
        <el-table-column prop="scope" label="适用范围" min-width="180" />
        <el-table-column prop="categories" label="材料清单" min-width="220" show-overflow-tooltip />
        <el-table-column prop="deadline" label="截止时间" width="130" />
        <el-table-column prop="status" label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.status === '收集中' ? 'success' : 'info'">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default>
            <el-button text>编辑</el-button>
            <el-button text>查看提交</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" title="材料任务表单" width="620px">
      <el-form label-width="104px">
        <el-form-item label="任务名称">
          <el-input />
        </el-form-item>
        <el-form-item label="适用范围">
          <el-select placeholder="选择项目范围" style="width: 100%">
            <el-option label="2026 年全部在研项目" value="2026" />
            <el-option label="已通过中期检查项目" value="mid-pass" />
          </el-select>
        </el-form-item>
        <el-form-item label="材料类别">
          <el-checkbox-group model-value="报告书">
            <el-checkbox-button label="报告书" />
            <el-checkbox-button label="研究日志" />
            <el-checkbox-button label="签字页" />
            <el-checkbox-button label="报销凭证" />
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="截止时间">
          <el-date-picker type="datetime" placeholder="选择截止时间" style="width: 100%" />
        </el-form-item>
        <el-form-item label="文件限制">
          <el-input placeholder="例如 PDF/DOCX/XLSX，单文件不超过 50MB" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="dialogVisible = false">发布</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { materialTasks } from '../../data/mock'

const dialogVisible = ref(false)
</script>
