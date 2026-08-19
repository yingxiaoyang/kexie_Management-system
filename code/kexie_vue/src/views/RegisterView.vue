<template>
  <main class="login-page">
    <section class="login-card register-card">
      <div class="login-intro">
        <el-tag effect="plain" type="success">申请人自主注册</el-tag>
        <h1>创建立项申请账号</h1>
        <p>本期不核验身份真实性，资料按本人填报保存。注册账号仅能访问自己的申请、材料与结果。</p>
        <el-alert title="学号和账号注册后不可自行更换，请确认无误。" type="warning" :closable="false" show-icon />
      </div>
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
        <div class="register-grid">
          <el-form-item label="姓名" prop="name"><el-input v-model.trim="form.name" maxlength="80" /></el-form-item>
          <el-form-item label="学号" prop="studentNo"><el-input v-model.trim="form.studentNo" maxlength="40" /></el-form-item>
          <el-form-item label="学院" prop="college"><el-input v-model.trim="form.college" maxlength="120" /></el-form-item>
          <el-form-item label="登录账号" prop="username"><el-input v-model.trim="form.username" autocomplete="username" maxlength="40" /></el-form-item>
          <el-form-item label="联系电话（选填）" prop="phone"><el-input v-model.trim="form.phone" /></el-form-item>
          <el-form-item label="邮箱（选填）" prop="email"><el-input v-model.trim="form.email" /></el-form-item>
        </div>
        <el-form-item label="密码" prop="password"><el-input v-model="form.password" type="password" show-password autocomplete="new-password" placeholder="10–72 位，至少包含字母和数字" /></el-form-item>
        <el-form-item label="确认密码" prop="confirmPassword"><el-input v-model="form.confirmPassword" type="password" show-password autocomplete="new-password" /></el-form-item>
        <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" show-icon />
        <el-button class="login-submit" type="primary" size="large" :loading="loading" @click="submit">注册账号</el-button>
        <el-button class="login-register" size="large" @click="router.push('/login')">返回登录</el-button>
      </el-form>
    </section>
  </main>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { apiRequest } from '../services/http'

const router = useRouter()
const formRef = ref()
const loading = ref(false)
const errorMessage = ref('')
const form = reactive({ name: '', studentNo: '', college: '', username: '', phone: '', email: '', password: '', confirmPassword: '' })
const rules = {
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  studentNo: [{ required: true, message: '请输入学号', trigger: 'blur' }, { pattern: /^[A-Za-z0-9-]{4,40}$/, message: '学号仅支持字母、数字和连字符', trigger: 'blur' }],
  college: [{ required: true, message: '请输入学院', trigger: 'blur' }],
  username: [{ required: true, message: '请输入登录账号', trigger: 'blur' }, { pattern: /^[A-Za-z0-9_.-]{4,40}$/, message: '账号为 4–40 位字母、数字或 ._-', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }, { validator: (_, value, callback) => value.length >= 10 && /[A-Za-z]/.test(value) && /\d/.test(value) ? callback() : callback(new Error('密码至少 10 位且包含字母和数字')), trigger: 'blur' }],
  confirmPassword: [{ validator: (_, value, callback) => value === form.password ? callback() : callback(new Error('两次密码不一致')), trigger: 'blur' }],
}
async function submit() {
  if (!(await formRef.value?.validate().catch(() => false))) return
  loading.value = true; errorMessage.value = ''
  try {
    await apiRequest('/auth/register', { method: 'POST', body: { name: form.name, studentNo: form.studentNo, college: form.college, username: form.username, phone: form.phone, email: form.email, password: form.password } })
    ElMessage.success('注册成功，请使用新账号登录')
    await router.replace('/login')
  } catch (error) { errorMessage.value = error.code === 'DUPLICATE_RESOURCE' ? '学号或账号已被注册' : error.message }
  finally { loading.value = false }
}
</script>
