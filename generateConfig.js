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

const fs = require('fs')
const path = require('path')

const {
  register_anonymous
} = require('./main')

const {
  cookieToJson,
  generateRandomChineseIP,
  generateDeviceId
} = require('./util/index')

const {
  getXeapiPublicKey
} = require('./util/xeapiKey')

const {
  loadNeapiKey
} = require('./util/neapiKey')

const registerNeapikey =
  require('./module/register_neapikey')

const tmpPath = require('os').tmpdir()

async function generateConfig() {
  global.cnIp = generateRandomChineseIP()

  // 第一步：生成并固定 deviceId
  if (!global.deviceId) {
    global.deviceId = generateDeviceId()
  }

  const deviceId = global.deviceId

  // 第二步：读取本地已有公钥
  let currentPublicKey = {}

  try {
    currentPublicKey = JSON.parse(
      fs.readFileSync(
        path.resolve(tmpPath, 'xeapi_public_key'),
        'utf-8'
      )
    )
  } catch (error) {
    console.log('[XEAPI] No cached public key')
  }

  // 第三步：先获取 XEAPI 公钥
  const publicKey = await getXeapiPublicKey(
    currentPublicKey,
    deviceId
  )

  if (!publicKey || !publicKey.sk) {
    throw new Error('XEAPI public key is invalid')
  }

  // 第四步：保存公钥
  fs.writeFileSync(
    path.resolve(tmpPath, 'xeapi_public_key'),
    JSON.stringify(publicKey),
    'utf-8'
  )

  console.log('[XEAPI] Public key saved successfully')
  console.log('[XEAPI] Device ID:', deviceId)

  // 第五步：注册匿名用户
  const res = await register_anonymous()

  const cookie = res.body.cookie

  if (cookie) {
    const cookieObj = cookieToJson(cookie)

    fs.writeFileSync(
      path.resolve(tmpPath, 'anonymous_token'),
      cookieObj.MUSIC_A || '',
      'utf-8'
    )
  }

  console.log('[XEAPI] Anonymous registration completed')

  // 第六步：获取 NEAPI 配置
  const current = loadNeapiKey()

  await registerNeapikey(
    {
      version: current ? current.version : 0,
      behavior: current ? 'update' : 'open'
    },
    null
  )
}

module.exports = generateConfig
