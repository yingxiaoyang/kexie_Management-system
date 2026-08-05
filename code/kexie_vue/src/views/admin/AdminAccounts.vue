<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">账号管理</h2>
        <p class="page-desc">第一版暂不接统一身份认证，账号由管理员创建并绑定角色。</p>
      </div>
      <el-button type="primary" @click="dialogVisible = true">
        <el-icon><Plus /></el-icon>
        新建账号
      </el-button>
    </div>

    <div class="panel">
      <div class="toolbar">
        <div class="filters">
          <el-input placeholder="搜索姓名或账号" clearable>
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <el-select model-value="" placeholder="角色" clearable style="width: 160px">
            <el-option label="管理员" value="管理员" />
            <el-option label="项目负责人" value="项目负责人" />
            <el-option label="只读查看人员" value="只读查看人员" />
          </el-select>
        </div>
      </div>
      <el-table :data="accounts" style="width: 100%">
        <el-table-column prop="name" label="姓名" width="120" />
        <el-table-column prop="account" label="账号" min-width="160" />
        <el-table-column prop="role" label="角色" width="150" />
        <el-table-column prop="status" label="状态" width="110" />
        <el-table-column label="操作" width="180" fixed="right">
          <template #default>
            <el-button text>重置密码</el-button>
            <el-button text>停用</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" title="账号表单" width="520px">
      <el-form label-width="82px">
        <el-form-item label="绑定人员">
          <el-input placeholder="选择或搜索人员" />
        </el-form-item>
        <el-form-item label="账号角色">
          <el-select placeholder="选择角色" style="width: 100%">
            <el-option label="管理员" value="管理员" />
            <el-option label="项目负责人" value="项目负责人" />
            <el-option label="只读查看人员" value="只读查看人员" />
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
import { accounts } from '../../data/mock'

const dialogVisible = ref(false)
</script>
