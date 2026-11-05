// 飞书表格 -> 网易云"我喜欢的音乐"同步器
// 工作方式：定时扫描多维表格中状态为"待执行"的记录，
// 按搜索词搜歌 -> 调 /api/v1/radio/like 加红心（进入"我喜欢的音乐"）-> 回写状态
//
// 依赖环境变量：
//   FEISHU_APP_ID / FEISHU_APP_SECRET   飞书自建应用凭据（需已发布并开通多维表格读写权限）
//   FEISHU_BASE_TOKEN / FEISHU_TABLE_ID 目标多维表格
//   FEISHU_FIELD_QUERY   搜索词字段名（默认"搜索词"）
//   FEISHU_FIELD_STATUS  状态字段名（默认"状态"，值：待执行/执行中/已完成/失败）
//   FEISHU_FIELD_TITLE   歌曲名称字段名（可选，成功后回写匹配到的歌名）
//   FEISHU_FIELD_ERROR   错误原因字段名（默认"错误原因"）
//   SYNC_INTERVAL_MS     轮询间隔毫秒（默认 60000）
//   NETEASE_COOKIE       网易云账号 Cookie（MUSIC_U=...），加红心必需

const axios = require('axios')
const logger = require('./logger.js')

let tokenCache = { token: '', expireAt: 0 }
let syncing = false

async function getTenantToken() {
  const now = Date.now()
  if (tokenCache.token && now < tokenCache.expireAt) return tokenCache.token
  const res = await axios.post(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET,
    },
    { timeout: 15000 },
  )
  const data = res.data || {}
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error('feishu token failed: ' + JSON.stringify(data).slice(0, 200))
  }
  tokenCache = {
    token: data.tenant_access_token,
    expireAt: now + ((data.expire || 7200) - 120) * 1000,
  }
  return tokenCache.token
}

function cellText(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) {
    return v.map((i) => (typeof i === 'string' ? i : (i && i.text) || '')).join('')
  }
  if (typeof v === 'object' && v.text) return String(v.text)
  return String(v)
}

async function listRecords() {
  const token = await getTenantToken()
  const items = []
  let pageToken = ''
  do {
    const q = new URLSearchParams({ page_size: '100' })
    if (pageToken) q.set('page_token', pageToken)
    const res = await axios.get(
      'https://open.feishu.cn/open-apis/bitable/v1/apps/' +
        process.env.FEISHU_BASE_TOKEN +
        '/tables/' +
        process.env.FEISHU_TABLE_ID +
        '/records?' +
        q.toString(),
      { headers: { Authorization: 'Bearer ' + token }, timeout: 15000 },
    )
    const data = (res.data && res.data.data) || {}
    items.push(...(data.items || []))
    pageToken = data.has_more ? data.page_token : ''
  } while (pageToken && items.length < 500)
  return items
}

async function updateRecord(recordId, fields) {
  const token = await getTenantToken()
  await axios.put(
    'https://open.feishu.cn/open-apis/bitable/v1/apps/' +
      process.env.FEISHU_BASE_TOKEN +
      '/tables/' +
      process.env.FEISHU_TABLE_ID +
      '/records/' +
      recordId,
    { fields },
    {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      timeout: 15000,
    },
  )
}

let mainModules = null
function api() {
  if (!mainModules) mainModules = require('../main')
  return mainModules
}

async function likeSong(songId) {
  const res = await api().like_v1({ id: songId, like: 'true' })
  const body = res && res.body
  if (Number(body && body.code) === 200) return true
  throw new Error('加红心失败: ' + JSON.stringify(body || res).slice(0, 200))
}

async function processPending() {
  const {
    FEISHU_FIELD_QUERY = '搜索词',
    FEISHU_FIELD_STATUS = '状态',
    FEISHU_FIELD_TITLE,
    FEISHU_FIELD_ERROR = '错误原因',
  } = process.env

  if (!process.env.NETEASE_COOKIE) {
    throw new Error('NETEASE_COOKIE 未配置（网易云未登录），无法加红心')
  }

  const records = await listRecords()
  const pending = records.filter((r) => {
    const f = r.fields || {}
    return (
      cellText(f[FEISHU_FIELD_STATUS]) === '待执行' && cellText(f[FEISHU_FIELD_QUERY])
    )
  })
  if (!pending.length) return { processed: 0 }

  const results = []
  for (const rec of pending) {
    const f = rec.fields || {}
    const query = cellText(f[FEISHU_FIELD_QUERY])
    const recordId = rec.record_id || rec.id
    const out = { recordId, query }
    try {
      const s = await api().search({ keywords: query, limit: 5 })
      const songs = (s.body && s.body.result && s.body.result.songs) || []
      if (!songs.length) throw new Error('搜索无结果: ' + query)
      const song = songs[0]
      await likeSong(song.id)
      const fields = { [FEISHU_FIELD_STATUS]: '已完成' }
      if (FEISHU_FIELD_TITLE) fields[FEISHU_FIELD_TITLE] = song.name
      await updateRecord(recordId, fields)
      out.ok = true
      out.song =
        song.name +
        ((song.artists && song.artists[0] && '-' + song.artists[0].name) || '')
    } catch (e) {
      out.ok = false
      out.error = e.message
      try {
        const failFields = { [FEISHU_FIELD_STATUS]: '失败', [FEISHU_FIELD_ERROR]: String(e.message).slice(0, 200) }
        await updateRecord(recordId, failFields)
      } catch (e2) {
        out.error += ' | 回写失败: ' + e2.message
      }
    }
    results.push(out)
  }
  return { processed: results.length, results }
}

function isConfigured() {
  return !!(
    process.env.FEISHU_APP_ID &&
    process.env.FEISHU_APP_SECRET &&
    process.env.FEISHU_BASE_TOKEN &&
    process.env.FEISHU_TABLE_ID
  )
}

function startFeishuSync() {
  if (!isConfigured()) {
    console.log(
      '[feishu-sync] 未配置 FEISHU_APP_ID/SECRET/BASE_TOKEN/TABLE_ID，同步器未启动（配置环境变量后重启即生效）',
    )
    return
  }
  const interval = Number(process.env.SYNC_INTERVAL_MS || 60000)
  console.log('[feishu-sync] started, interval=' + interval + 'ms')
  const tick = async () => {
    if (syncing) return
    syncing = true
    try {
      const r = await processPending()
      if (r.processed) console.log('[feishu-sync] ' + JSON.stringify(r).slice(0, 600))
    } catch (e) {
      console.log('[feishu-sync] error: ' + e.message)
    } finally {
      syncing = false
    }
  }
  setTimeout(tick, 10000)
  setInterval(tick, interval)
}

module.exports = { processPending, startFeishuSync, isConfigured }
