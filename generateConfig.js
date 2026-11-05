const fs = require('fs')
const path = require('path')
const { register_anonimous } = require('./main')
const {
  cookieToJson,
  generateRandomChineseIP,
  generateDeviceId,
} = require('./util/index')
const { getXeapiPublicKey } = require('./util/xeapiKey')
const { loadNeapiKey } = require('./util/neapiKey')
const registerNeapikey = require('./module/register_neapikey')
const tmpPath = require('os').tmpdir()

async function generateConfig() {
  global.cnIp = generateRandomChineseIP()

  // ===== 第 1 步：确定唯一 deviceId（全局只生成一次，公钥与匿名注册共用） =====
  if (!global.deviceId) {
    global.deviceId = generateDeviceId()
  }
  console.log('[init][1/4] deviceId ready:', global.deviceId)

  // ===== 第 2 步：先获取并保存 XEAPI 公钥 =====
  // 匿名注册走 xeapi 加密请求，必须先有公钥，否则报 "xeapi public key is missing"
  let currentPublicKey = {}
  try {
    currentPublicKey = JSON.parse(
      fs.readFileSync(path.resolve(tmpPath, 'xeapi_public_key'), 'utf-8'),
    )
  } catch (_) {
    // 首次部署或 Render /tmp 被清空，属正常情况
  }
  const publicKey = await getXeapiPublicKey(currentPublicKey, global.deviceId)
  fs.writeFileSync(
    path.resolve(tmpPath, 'xeapi_public_key'),
    JSON.stringify(publicKey),
    'utf-8',
  )
  console.log(
    '[init][2/4] xeapi public key saved, version:',
    publicKey.version || 'unknown',
  )

  // ===== 第 3 步：注册匿名用户（复用同一个 deviceId），保存 MUSIC_A =====
  // 注意：Render 出口 IP 在海外，匿名注册接口会返回 code 400；
  // 带上中国 IP 头（X-Real-IP/X-Forwarded-For）可规避。
  // 该步骤失败不阻断启动：搜索、歌曲详情、播放链接不依赖 MUSIC_A。
  try {
    const res = await register_anonimous({ realIP: global.cnIp })
    const cookie = res.body && res.body.cookie
    if (!cookie || cookie.indexOf('MUSIC_A=') === -1) {
      throw new Error(
        'no MUSIC_A cookie, body=' +
          JSON.stringify(res.body || res).slice(0, 300),
      )
    }
    const cookieObj = cookieToJson(cookie)
    fs.writeFileSync(
      path.resolve(tmpPath, 'anonymous_token'),
      cookieObj.MUSIC_A,
      'utf-8',
    )
    console.log('[init][3/4] anonymous token (MUSIC_A) saved')
  } catch (error) {
    console.log(
      '[init][3/4] anonymous register failed (non-fatal):',
      error.message,
    )
  }

  // ===== 第 4 步：NEAPI 配置（独立阶段，失败暂不阻断启动，后续单独排查） =====
  try {
    const current = loadNeapiKey()
    await registerNeapikey(
      {
        version: current ? current.version : 0,
        behavior: current ? 'update' : 'open',
      },
      null,
    )
    console.log('[init][4/4] neapi key saved')
  } catch (error) {
    console.log('[init][4/4] neapi config failed (non-fatal):', error.message)
  }
}

module.exports = generateConfig
