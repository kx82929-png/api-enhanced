// 手动触发一次"飞书表格 -> 网易云我喜欢"同步
// 用途：飞书自动化流程可以直接请求本接口，唤醒服务并立即处理新记录
// 用法：GET /feishu_sync_trigger
const { processPending } = require('../util/feishuSync')

module.exports = async () => {
  try {
    const result = await processPending()
    return {
      status: 200,
      body: { code: 200, ...result },
      cookie: [],
    }
  } catch (e) {
    return {
      status: 200,
      body: { code: 500, message: e.message },
      cookie: [],
    }
  }
}
