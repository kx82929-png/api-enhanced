// 飞书表格 -> 网易云 自动同步器
// 工作方式：定时扫描多维表格中状态为"待同步"的记录，
//   优先用"网易云歌曲ID"直接加歌（无 ID 时才按搜索词搜第一首），
//   有"目标歌单ID"就加入该歌单，没有就加红心（进"我喜欢的音乐"），
//   成功后回写状态与结果。
//
// 依赖环境变量：
//   FEISHU_APP_ID / FEISHU_APP_SECRET   飞书自建应用凭据（需已发布并开通多维表格读写权限）
//   FEISHU_BASE_TOKEN / FEISHU_TABLE_ID 目标多维表格
//   FEISHU_FIELD_SONG_ID   歌曲ID字段名（如"网易云歌曲ID"）
//   FEISHU_FIELD_QUERY     搜索词字段名（可选，没有歌曲ID时才用）
//   FEISHU_FIELD_STATUS    状态字段名（如"同步状态"）
//   FEISHU_STATUS_PENDING  待处理状态值（默认"待同步"）
//   FEISHU_STATUS_DONE     成功状态值（默认"已同步"）
//   FEISHU_STATUS_FAILED   失败状态值（默认"同步失败"）
//   FEISHU_STATUS_DELETE   删除状态值（默认"待删除"）：状态为此值的行会被从网易云移除
//   FEISHU_FIELD_PLAYLIST_ID   目标歌单ID字段名（如"目标歌单ID"，可选）
//   FEISHU_FIELD_PLAYLIST_NAME 目标歌单名称字段名（如"AI 目标歌单"，可选）
//   FEISHU_FIELD_RESULT    结果字段名（如"AI 同步结果"，可选）
//   SYNC_INTERVAL_MS       轮询间隔毫秒（默认 60000）
//   NETEASE_COOKIE         网易云账号 Cookie（MUSIC_U=...），必需

const axios = require('axios')

// 兼容两种变量名：FEISHU_BASE_TOKEN 或 FEISHU_APP_TOKEN
function baseToken() {
  return process.env.FEISHU_BASE_TOKEN || process.env.FEISHU_APP_TOKEN || ''
}

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
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) {
    return v
      .map((i) => (typeof i === 'string' ? i : (i && (i.text || i.name)) || ''))
      .join('')
  }
  if (typeof v === 'object') {
    if (v.text) return String(v.text)
    if (v.name) return String(v.name)
    if (v.link) return String(v.link)
  }
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
        baseToken() +
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
      baseToken() +
      '/tables/' +
      process.env.FEISHU_TABLE_ID +
      '/records/' +
      recordId,
    { fields },
    {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    },
  )
}

// 从各种错误形态中提取可读原因（网易云接口错误常以 {code,message} 形式挂在 e.body 上）
function errText(e) {
  if (!e) return '未知错误'
  if (e.message) return String(e.message)
  const b = e.body || e
  if (b && (b.message || b.msg)) return String(b.message || b.msg)
  try {
    return JSON.stringify(b).slice(0, 180)
  } catch (_) {
    return String(b)
  }
}

let mainModules = null
function api() {
  if (!mainModules) mainModules = require('../main')
  return mainModules
}

// 加入歌单
async function addToPlaylist(songId, playlistId) {
  const res = await api().playlist_tracks({
    op: 'add',
    pid: playlistId,
    tracks: String(songId),
  })
  const body = res && res.body
  const code = Number(body && body.code)
  // 502 = 歌单里已有该歌曲（视为成功）
  if (code === 200 || code === 502) return code === 502 ? 'already' : 'added'
  const reason = (body && (body.message || body.msg)) || JSON.stringify(body || res).slice(0, 160)
  throw new Error('加入歌单失败: ' + reason)
}

// 加红心（进"我喜欢的音乐"）
async function likeSong(songId) {
  const res = await api().like_v1({ id: songId, like: 'true' })
  const body = res && res.body
  if (Number(body && body.code) === 200) return 'liked'
  const reason = (body && (body.message || body.msg)) || JSON.stringify(body || res).slice(0, 160)
  throw new Error('加红心失败: ' + reason)
}

// 取消红心（从"我喜欢的音乐"移除）
async function unlikeSong(songId) {
  const res = await api().like_v1({ id: songId, like: 'false' })
  const body = res && res.body
  if (Number(body && body.code) === 200) return 'unliked'
  const reason = (body && (body.message || body.msg)) || JSON.stringify(body || res).slice(0, 160)
  throw new Error('取消红心失败: ' + reason)
}

// 从指定歌单移除
async function removeFromPlaylist(songId, playlistId) {
  const res = await api().playlist_tracks({
    op: 'del',
    pid: playlistId,
    tracks: String(songId),
  })
  const body = res && res.body
  const code = Number(body && body.code)
  // 502 = 歌单里没有该歌曲（视为已移除）
  if (code === 200 || code === 502) return 'removed'
  const reason = (body && (body.message || body.msg)) || JSON.stringify(body || res).slice(0, 160)
  throw new Error('移除失败: ' + reason)
}

async function processPending() {
  const {
    FEISHU_FIELD_SONG_ID,
    FEISHU_FIELD_QUERY,
    FEISHU_FIELD_STATUS,
    FEISHU_STATUS_PENDING = '待同步',
    FEISHU_STATUS_DONE = '已同步',
    FEISHU_STATUS_FAILED = '同步失败',
    FEISHU_STATUS_DELETE = '待删除',
    FEISHU_FIELD_PLAYLIST_ID,
    FEISHU_FIELD_PLAYLIST_NAME,
    FEISHU_FIELD_RESULT,
  } = process.env

  if (!FEISHU_FIELD_STATUS) throw new Error('未配置 FEISHU_FIELD_STATUS（状态列名）')
  if (!FEISHU_FIELD_SONG_ID && !FEISHU_FIELD_QUERY) {
    throw new Error('需要配置 FEISHU_FIELD_SONG_ID 或 FEISHU_FIELD_QUERY 之一')
  }
  if (!process.env.NETEASE_COOKIE) {
    throw new Error('NETEASE_COOKIE 未配置（网易云未登录）')
  }

  const records = await listRecords()
  // 待同步 = 添加；待删除 = 移除。两种都要求行里有歌曲ID或搜索词
  const pending = records.filter((r) => {
    const f = r.fields || {}
    const status = cellText(f[FEISHU_FIELD_STATUS])
    const hasTarget =
      (FEISHU_FIELD_SONG_ID && cellText(f[FEISHU_FIELD_SONG_ID])) ||
      (FEISHU_FIELD_QUERY && cellText(f[FEISHU_FIELD_QUERY]))
    return (
      (status === FEISHU_STATUS_PENDING || status === FEISHU_STATUS_DELETE) &&
      !!hasTarget
    )
  })
  if (!pending.length) return { processed: 0 }

  const results = []
  for (const rec of pending) {
    const f = rec.fields || {}
    const recordId = rec.record_id || rec.id
    const songId = FEISHU_FIELD_SONG_ID ? cellText(f[FEISHU_FIELD_SONG_ID]) : ''
    const query = FEISHU_FIELD_QUERY ? cellText(f[FEISHU_FIELD_QUERY]) : ''
    const playlistId = FEISHU_FIELD_PLAYLIST_ID
      ? cellText(f[FEISHU_FIELD_PLAYLIST_ID])
      : ''
    const playlistName = FEISHU_FIELD_PLAYLIST_NAME
      ? cellText(f[FEISHU_FIELD_PLAYLIST_NAME])
      : ''
    const out = { recordId, songId, query, playlistId }
    const isDelete =
      FEISHU_FIELD_STATUS &&
      cellText(f[FEISHU_FIELD_STATUS]) === FEISHU_STATUS_DELETE
    if (isDelete) out.mode = 'remove'
    try {
      let targetId = songId
      if (!targetId) {
        const s = await api().search({ keywords: query, limit: 5 })
        const songs = (s.body && s.body.result && s.body.result.songs) || []
        if (!songs.length) throw new Error('搜索无结果: ' + query)
        targetId = songs[0].id
        out.matched = songs[0].name
      }
      let action
      if (isDelete) {
        // 删除流程：有目标歌单ID就从该歌单移除，否则取消红心（移出"我喜欢的音乐"）
        if (playlistId) {
          action = await removeFromPlaylist(targetId, playlistId)
          out.removedFrom = '歌单 ' + (playlistName || playlistId)
        } else {
          action = await unlikeSong(targetId)
          out.removedFrom = '我喜欢的音乐'
        }
      } else if (playlistId) {
        action = await addToPlaylist(targetId, playlistId)
        out.addedTo = '歌单 ' + (playlistName || playlistId)
      } else {
        action = await likeSong(targetId)
        out.addedTo = '我喜欢的音乐'
      }
      const doneFields = { [FEISHU_FIELD_STATUS]: FEISHU_STATUS_DONE }
      if (FEISHU_FIELD_RESULT) {
        if (isDelete) {
          doneFields[FEISHU_FIELD_RESULT] = '已从' + out.removedFrom + '移除'
        } else {
          doneFields[FEISHU_FIELD_RESULT] =
            action === 'already'
              ? '已在' + out.addedTo + '中'
              : '已加入' + out.addedTo
        }
      }
      await updateRecord(recordId, doneFields)
      out.ok = true
      out.action = action
    } catch (e) {
      out.ok = false
      out.error = errText(e)
      try {
        const failFields = { [FEISHU_FIELD_STATUS]: FEISHU_STATUS_FAILED }
        if (FEISHU_FIELD_RESULT) {
          failFields[FEISHU_FIELD_RESULT] = errText(e).slice(0, 180)
        }
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
    baseToken() &&
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
      if (r.processed) {
        console.log('[feishu-sync] processed=' + r.processed)
        for (const it of r.results || []) {
          console.log('[feishu-sync] ' + JSON.stringify(it))
        }
      }
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
