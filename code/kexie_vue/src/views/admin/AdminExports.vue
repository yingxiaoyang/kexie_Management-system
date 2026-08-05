<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">整理包导出</h2>
        <p class="page-desc">按归档模板生成材料整理包，并记录导出批次。</p>
      </div>
      <el-button type="primary" @click="dialogVisible = true">
        <el-icon><Download /></el-icon>
        新建导出
      </el-button>
    </div>

    <div class="panel">
      <el-table :data="exportRecords" style="width: 100%">
        <el-table-column prop="batch" label="导出批次" min-width="170" />
        <el-table-column prop="template" label="使用模板" min-width="190" />
        <el-table-column prop="scope" label="导出范围" min-width="150" />
        <el-table-column prop="operator" label="导出人" width="110" />
        <el-table-column prop="exportedAt" label="导出时间" width="170" />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default>
            <el-button text>下载</el-button>
            <el-button text>详情</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" title="新建导出任务" width="560px">
      <el-form label-width="92px">
        <el-form-item label="归档模板">
          <el-select placeholder="选择模板" style="width: 100%">
            <el-option label="年度-组别-项目编号模板" value="年度-组别-项目编号模板" />
          </el-select>
        </el-form-item>
        <el-form-item label="导出范围">
          <el-input placeholder="例如 2026 年中期检查" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="dialogVisible = false">开始导出</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { exportRecords } from '../../data/mock'

const dialogVisible = ref(false)
</script>
