<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">材料审核</h2>
        <p class="page-desc">审核动作包括通过与退回，退回时必须填写原因。</p>
      </div>
    </div>

    <div class="panel">
      <div class="toolbar">
        <div class="filters">
          <el-input placeholder="搜索项目、材料、提交人" clearable>
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <el-select model-value="待审核" placeholder="审核状态" clearable style="width: 150px">
            <el-option label="待审核" value="待审核" />
            <el-option label="通过" value="通过" />
            <el-option label="退回" value="退回" />
          </el-select>
        </div>
        <div class="toolbar-actions">
          <el-button type="success">
            <el-icon><Check /></el-icon>
            批量通过
          </el-button>
        </div>
      </div>
      <el-table :data="reviewItems" style="width: 100%">
        <el-table-column type="selection" width="48" />
        <el-table-column prop="project" label="项目" min-width="220" show-overflow-tooltip />
        <el-table-column prop="material" label="材料类别" width="150" />
        <el-table-column prop="submitter" label="提交人" width="100" />
        <el-table-column prop="submittedAt" label="提交时间" width="170" />
        <el-table-column prop="status" label="审核状态" width="110">
          <template #default="{ row }">
            <el-tag type="warning">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="210" fixed="right">
          <template #default>
            <el-button text type="success">通过</el-button>
            <el-button text type="danger" @click="rejectVisible = true">退回</el-button>
            <el-button text>下载</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="rejectVisible" title="填写退回原因" width="520px">
      <el-form label-width="92px">
        <el-form-item label="退回原因" required>
          <el-input type="textarea" :rows="4" placeholder="请说明负责人需要补充或修改的内容" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectVisible = false">取消</el-button>
        <el-button type="danger" @click="rejectVisible = false">确认退回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { reviewItems } from '../../data/mock'

const rejectVisible = ref(false)
</script>
