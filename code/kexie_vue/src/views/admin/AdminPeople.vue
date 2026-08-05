<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">人员库管理</h2>
        <p class="page-desc">统一维护学生、指导老师和联系方式，便于项目关联与规则校验。</p>
      </div>
      <el-button type="primary" @click="dialogVisible = true">
        <el-icon><Plus /></el-icon>
        新增人员
      </el-button>
    </div>

    <div class="panel">
      <div class="toolbar">
        <div class="filters">
          <el-input placeholder="搜索姓名、学号、工号、电话、学院" clearable>
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <el-select model-value="" placeholder="人员类型" clearable style="width: 150px">
            <el-option label="学生" value="学生" />
            <el-option label="指导老师" value="指导老师" />
          </el-select>
        </div>
        <div class="toolbar-actions">
          <el-button>
            <el-icon><Upload /></el-icon>
            导入人员
          </el-button>
        </div>
      </div>

      <el-table :data="people" style="width: 100%">
        <el-table-column prop="name" label="姓名" width="100" />
        <el-table-column prop="type" label="类型" width="110" />
        <el-table-column prop="identifier" label="学号/工号" width="150" />
        <el-table-column prop="org" label="学院/单位" min-width="150" />
        <el-table-column prop="phone" label="电话" width="140" />
        <el-table-column prop="status" label="账号状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.status === '启用' ? 'success' : 'info'">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default>
            <el-button text>编辑</el-button>
            <el-button text>参与项目</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" title="人员表单" width="560px">
      <el-form label-width="92px">
        <el-form-item label="人员类型">
          <el-radio-group model-value="学生">
            <el-radio-button label="学生" />
            <el-radio-button label="指导老师" />
          </el-radio-group>
        </el-form-item>
        <el-form-item label="姓名">
          <el-input />
        </el-form-item>
        <el-form-item label="学号/工号">
          <el-input />
        </el-form-item>
        <el-form-item label="联系方式">
          <el-input />
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
import { people } from '../../data/mock'

const dialogVisible = ref(false)
</script>
