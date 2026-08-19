<template>
  <main class="login-page">
    <section class="login-card">
      <div class="login-intro">
        <el-tag effect="plain">真实试用版</el-tag>
        <h1>科研项目材料管理平台</h1>
        <p>申请人自主注册并提交立项材料；管理员仅审核材料合格性，学校结果导入后才建立正式项目。</p>
      </div>
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
        <el-form-item label="账号/学号" prop="username">
          <el-input v-model.trim="form.username" size="large" autocomplete="username" placeholder="请输入账号或学号" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" size="large" type="password" show-password autocomplete="current-password" placeholder="请输入密码" @keyup.enter="submit" />
        </el-form-item>
        <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon :closable="false" />
        <el-button class="login-submit" type="primary" size="large" :loading="loading" @click="submit">登录</el-button>
        <el-button class="login-register" size="large" @click="router.push('/register')">申请人自主注册</el-button>
      </el-form>
      <p class="login-tip">首次登录或管理员重置密码后，系统会要求立即修改密码。</p>
    </section>
  </main>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const formRef = ref()
const loading = ref(false)
const errorMessage = ref('')
const form = reactive({ username: '', password: '' })
const loginErrorMessages = {
  INVALID_CREDENTIALS: '账号或密码错误',
  ACCOUNT_LOCKED: '账号已临时锁定，请稍后再试',
  LOGIN_RATE_LIMITED: '登录尝试过于频繁，请稍后再试',
}
const rules = {
  username: [{ required: true, message: '请输入账号或学号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function submit() {
  if (!(await formRef.value?.validate().catch(() => false))) return
  loading.value = true
  errorMessage.value = ''
  try {
    const user = await authStore.login(form)
    if (user.passwordResetRequired) await router.replace('/change-password')
    else await router.replace(route.query.redirect || authStore.homeForRole(user.role))
  } catch (error) {
    errorMessage.value = loginErrorMessages[error.code] || error.message
  } finally {
    loading.value = false
  }
}
</script>
