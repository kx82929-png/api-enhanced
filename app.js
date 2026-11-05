#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const tmpPath = require('os').tmpdir()

async function start() {
  // 检测是否存在 anonymous_token 文件,没有则生成
  if (!fs.existsSync(path.resolve(tmpPath, 'anonymous_token'))) {
    fs.writeFileSync(path.resolve(tmpPath, 'anonymous_token'), '', 'utf-8')
  }
  // 启动时更新anonymous_token
  const generateConfig = require('./generateConfig')
  try {
    await generateConfig()
  } catch (error) {
    // 初始化失败时停止启动：公钥/匿名 Token 未就绪就开放服务，
    // 只会让第一批请求全部失败（Render 会显示 Crash，便于在日志中定位）
    console.error('[init] initialization failed, server will NOT start:')
    console.error(error)
    process.exit(1)
  }
  require('./server').serveNcmApi({
    checkVersion: true,
  })

  // 启动"飞书表格 -> 网易云我喜欢的音乐"同步器（未配置飞书环境变量时自动跳过）
  try {
    require('./util/feishuSync').startFeishuSync()
  } catch (error) {
    console.log('[feishu-sync] start failed: ' + (error && error.message))
  }
}

start().catch((error) => {
  console.error('[init] unexpected startup error:')
  console.error(error)
  process.exit(1)
})
