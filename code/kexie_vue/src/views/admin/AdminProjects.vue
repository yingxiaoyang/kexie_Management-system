<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">项目管理</h2>
        <p class="page-desc">项目基础信息建议来自规范项目表导入，也支持后台维护。</p>
      </div>
      <el-button type="primary" @click="dialogVisible = true">
        <el-icon><Plus /></el-icon>
        新增项目
      </el-button>
    </div>

    <div class="panel">
      <div class="toolbar">
        <div class="filters">
          <el-input placeholder="搜索项目编号、作品名称、负责人" clearable>
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <el-select model-value="" placeholder="年度" clearable style="width: 140px">
            <el-option label="2026" value="2026" />
            <el-option label="2025" value="2025" />
          </el-select>
          <el-select model-value="" placeholder="项目状态" clearable style="width: 150px">
            <el-option label="进行中" value="进行中" />
            <el-option label="阶段检查" value="阶段检查" />
            <el-option label="已结项" value="已结项" />
          </el-select>
        </div>
        <div class="toolbar-actions">
          <el-button>
            <el-icon><Upload /></el-icon>
            批量导入
          </el-button>
          <el-button>
            <el-icon><Download /></el-icon>
            导出
          </el-button>
        </div>
      </div>

      <el-table :data="adminProjects" style="width: 100%">
        <el-table-column type="selection" width="48" />
        <el-table-column prop="year" label="年度" width="90" />
        <el-table-column prop="group" label="组别" width="130" />
        <el-table-column prop="code" label="项目编号" width="140" />
        <el-table-column prop="name" label="作品名称" min-width="220" show-overflow-tooltip />
        <el-table-column prop="owner" label="负责人" width="100" />
        <el-table-column prop="status" label="状态" width="110">
          <template #default="{ row }">
            <el-tag effect="plain">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default>
            <el-button text>编辑</el-button>
            <el-button text>成员</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" title="项目表单" width="560px">
      <el-form label-width="96px">
        <el-form-item label="项目年度">
          <el-input placeholder="例如 2026" />
        </el-form-item>
        <el-form-item label="项目编号">
          <el-input placeholder="例如 CX2026-001" />
        </el-form-item>
        <el-form-item label="作品名称">
          <el-input />
        </el-form-item>
        <el-form-item label="项目类别">
          <el-select placeholder="选择类别" style="width: 100%">
            <el-option label="创新训练" value="创新训练" />
            <el-option label="创业训练" value="创业训练" />
          </el-select>
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
import { adminProjects } from '../../data/mock'

const dialogVisible = ref(false)
</script>
