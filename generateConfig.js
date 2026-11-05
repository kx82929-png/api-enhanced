
const fs = require('fs')
const path = require('path')
const os = require('os')

const { register_anonymous } = require('./main')

const {
  cookieToJson,
  generateRandomChineseIP,
  generateDeviceId,
} = require('./util/index')

const { getXeapiPublicKey } = require('./util/xeapiKey')

const tmpPath = os.tmpdir()

async function generateConfig() {
  console.log('[INIT] Starting configuration')

  // 第一步：生成中国 IP
  global.cnIp = generateRandomChineseIP()

  // 第二步：固定设备 ID
  if (!global.deviceId) {
    global.deviceId = generateDeviceId()
  }

  const deviceId = global.deviceId

  console.log('[XEAPI] Device ID:', deviceId)

  const publicKeyPath = path.resolve(
    tmpPath,
    'xeapi_public_key'
  )

  // 第三步：读取已有公钥
  let currentPublicKey = {}

  try {
    if (fs.existsSync(publicKeyPath)) {
      currentPublicKey = JSON.parse(
        fs.readFileSync(publicKeyPath, 'utf-8')
      )
    }
  } catch (error) {
    console.log(
      '[XEAPI] Cached public key invalid:',
      error.message
    )
  }

  // 第四步：优先获取 XEAPI 公钥
  console.log('[XEAPI] Requesting public key...')

  const publicKey = await getXeapiPublicKey(
    currentPublicKey,
    deviceId
  )

  if (!publicKey || !publicKey.sk) {
    throw new Error(
      '[XEAPI] Public key missing or invalid'
    )
  }

  // 第五步：保存公钥
  fs.writeFileSync(
    publicKeyPath,
    JSON.stringify(publicKey),
    'utf-8'
  )

  // 第六步：重新读取验证
  const savedKey = JSON.parse(
    fs.readFileSync(publicKeyPath, 'utf-8')
  )

  if (!savedKey.sk) {
    throw new Error(
      '[XEAPI] Public key verification failed'
    )
  }

  console.log(
    '[XEAPI] Public key saved successfully'
  )

  // 第七步：注册匿名用户
  console.log('[ANONYMOUS] Registering...')

  const res = await register_anonymous()

  if (
    !res ||
    !res.body ||
    Number(res.body.code) !== 200
  ) {
    throw new Error(
      '[ANONYMOUS] Registration failed: ' +
      JSON.stringify(res?.body || {})
    )
  }

  const cookie = res.body.cookie

  if (cookie) {
    const cookieObj = cookieToJson(cookie)

    if (cookieObj.MUSIC_A) {
      fs.writeFileSync(
        path.resolve(tmpPath, 'anonymous_token'),
        cookieObj.MUSIC_A,
        'utf-8'
      )
    }
  }

  console.log(
    '[ANONYMOUS] Registration completed'
  )

  console.log(
    '[INIT] XEAPI initialization completed'
  )
}

module.exports = generateConfig
