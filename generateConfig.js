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


const fs = require('fs')
const path = require('path')
const { register_anonymous } = require('./main')
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

  // 第一步：先生成并固定设备ID
  if (!global.deviceId) {
    global.deviceId = generateDeviceId()
  }

  // 第二步：优先初始化XEAPI公钥
  try {
    let currentPublicKey = {}

    try {
      currentPublicKey = JSON.parse(
        fs.readFileSync(
          path.resolve(tmpPath, 'xeapi_public_key'),
          'utf-8',
        ),
      )
    } catch (_) {}

    const publicKey = await getXeapiPublicKey(
      currentPublicKey,
      global.deviceId,
    )

    if (!publicKey || !publicKey.sk) {
      throw new Error('XEAPI public key initialization failed')
    }

    fs.writeFileSync(
      path.resolve(tmpPath, 'xeapi_public_key'),
      JSON.stringify(publicKey),
      'utf-8',
    )

    console.log('[XEAPI] Public key initialized successfully')
  } catch (error) {
    console.error('[XEAPI] Initialization failed:', error)
    throw error
  }

  // 第三步：公钥初始化完成后，再注册匿名账号
  try {
    const res = await register_anonymous()
    const cookie = res.body.cookie

    if (cookie) {
      const cookieObj = cookieToJson(cookie)

      fs.writeFileSync(
        path.resolve(tmpPath, 'anonymous_token'),
        cookieObj.MUSIC_A || '',
        'utf-8',
      )
    }
  } catch (error) {
    console.error('[Anonymous] Registration failed:', error)
    throw error
  }

  // 第四步：初始化NEAPI配置
  try {
    const current = loadNeapiKey()

    await registerNeapikey(
      {
        version: current ? current.version : 0,
        behavior: current ? 'update' : 'open',
      },
      null,
    )
  } catch (error) {
    console.error('[NEAPI] Initialization failed:', error)
  }
}

module.exports = generateConfig

    const cookie = res.body.cookie
    if (cookie) {
      const cookieObj = cookieToJson(cookie)
      fs.writeFileSync(
        path.resolve(tmpPath, 'anonymous_token'),
        cookieObj.MUSIC_A,
        'utf-8',
      )
    }
  } catch (error) {
    console.log(error)
  }
  try {
    let currentPublicKey = {}
    try {
      currentPublicKey = JSON.parse(
        fs.readFileSync(path.resolve(tmpPath, 'xeapi_public_key'), 'utf-8'),
      )
    } catch (_) {}
    const publicKey = await getXeapiPublicKey(currentPublicKey, global.deviceId)
    fs.writeFileSync(
      path.resolve(tmpPath, 'xeapi_public_key'),
      JSON.stringify(publicKey),
      'utf-8',
    )
  } catch (error) {
    console.log(error)
  }
  try {
    const current = loadNeapiKey()
    await registerNeapikey(
      {
        version: current ? current.version : 0,
        behavior: current ? 'update' : 'open',
      },
      null,
    )
  } catch (error) {
    console.log(error)
  }
}
module.exports = generateConfig
