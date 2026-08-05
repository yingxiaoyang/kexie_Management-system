<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">参与规则</h2>
        <p class="page-desc">导入或编辑项目参与关系时，用这些规则提前拦截违规数据。</p>
      </div>
      <el-button type="primary" @click="dialogVisible = true">
        <el-icon><Plus /></el-icon>
        新建规则
      </el-button>
    </div>

    <div class="panel">
      <el-table :data="participationRules" style="width: 100%">
        <el-table-column prop="name" label="规则名称" min-width="180" />
        <el-table-column prop="value" label="规则内容" min-width="220" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag type="success">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default>
            <el-button text>编辑</el-button>
            <el-button text>停用</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" title="参与规则表单" width="540px">
      <el-form label-width="92px">
        <el-form-item label="规则名称">
          <el-input />
        </el-form-item>
        <el-form-item label="限制对象">
          <el-select placeholder="选择对象" style="width: 100%">
            <el-option label="项目负责人" value="owner" />
            <el-option label="项目成员" value="member" />
            <el-option label="指导老师" value="mentor" />
          </el-select>
        </el-form-item>
        <el-form-item label="数量上限">
          <el-input-number :min="1" :max="20" />
        </el-form-item>
        <el-form-item label="启用状态">
          <el-switch model-value />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="dialogVisible = false">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { participationRules } from '../../data/mock'

const dialogVisible = ref(false)
</script>
