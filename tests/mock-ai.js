// 第 5 期测试辅助：mock chrome.runtime.sendMessage 的 AI_CHAT 响应
export function install() {
  const p = JSON.parse(localStorage.getItem('pocketcv.profile.v1'));
  const fid = p.modules[0].entries[0].fields[0].id;
  const response = {
    ok: true,
    data: {
      content: '以下是建议：\n```json\n{"suggestions":['
        + JSON.stringify({ id: fid, content: '五年前端经验，主导增长平台搭建，深度使用 React/Vue' })
        + ',' + JSON.stringify({ id: 'f_fake_injection', content: '伪造注入应该被忽略' })
        + ',' + JSON.stringify({ id: 'bad-object', content: 123 })
        + ']}\n```\n以上。',
    },
  };
  window.__origSendMessage = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = async () => response;
  return fid;
}
export function restore() {
  if (window.__origSendMessage) chrome.runtime.sendMessage = window.__origSendMessage;
}
