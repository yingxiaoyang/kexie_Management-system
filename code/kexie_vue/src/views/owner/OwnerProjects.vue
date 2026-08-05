<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">我的项目</h2>
        <p class="page-desc">负责人仅查看自己关联项目及指导老师信息。</p>
      </div>
    </div>

    <div class="panel">
      <el-table :data="ownerProjects" style="width: 100%">
        <el-table-column prop="code" label="项目编号" width="140" />
        <el-table-column prop="name" label="作品名称" min-width="220" show-overflow-tooltip />
        <el-table-column prop="group" label="组别" width="130" />
        <el-table-column prop="category" label="项目类别" width="130" />
        <el-table-column prop="mentor" label="指导老师" width="110" />
        <el-table-column prop="status" label="状态" width="110">
          <template #default="{ row }">
            <el-tag effect="plain">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default>
            <el-button text>
              <el-icon><View /></el-icon>
              详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ownerProjects } from '../../data/mock'
</script>
