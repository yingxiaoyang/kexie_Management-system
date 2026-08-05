<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">项目通讯录</h2>
        <p class="page-desc">负责人端仅展示当前项目授权范围内的成员和指导老师联系方式。</p>
      </div>
    </div>

    <div class="panel">
      <div class="toolbar">
        <div class="filters">
          <el-input placeholder="搜索姓名、学院、电话" clearable>
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </div>
      </div>
      <el-table :data="projectContacts" style="width: 100%">
        <el-table-column prop="name" label="姓名" width="110" />
        <el-table-column prop="role" label="项目角色" width="130" />
        <el-table-column prop="org" label="学院/单位" min-width="150" />
        <el-table-column prop="phone" label="电话" width="140" />
        <el-table-column prop="qq" label="QQ" width="110" />
        <el-table-column prop="email" label="邮箱" min-width="190" show-overflow-tooltip />
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { projectContacts } from '../../data/mock'
</script>
