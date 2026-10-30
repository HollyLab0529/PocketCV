# 口袋简历 PocketCV

把求职资料装进浏览器侧栏：本地管理个人信息、教育、实习与项目经历，在招聘网页上逐项精准填入。零依赖、零上报，数据只存在你自己的浏览器里。

![License](https://img.shields.io/badge/license-MIT-green) ![Chrome](https://img.shields.io/badge/Chrome-116%2B-4285F4)

## 功能

- **资料管理**：分类 / 分层（常用 / 扩展 / 备用）/ 记录 / 四级字段模型，敏感字段遮挡显示 + 会话级信任，全局搜索，5 套莫兰迪主题，4 档界面字号缩放。
- **网页填写**：点选网页输入框 → 侧栏“填入”。带令牌防错位、受控组件写入（React / Vue）、Shadow DOM 穿透、下拉两级匹配（同名取首项、模糊多项拒绝）、逐次可撤销；不请求任何网站数据，只在你点击时向当前标签页注入脚本。
- **一键核对本页表单**：点「更多 → 一键核对本页表单」，插件扫描页面全部输入框，用同义词 + 模糊匹配把资料字段对上号，分三类处理——**待补齐**（空框勾选后填入）、**与资料不一致**（网站解析错的值与资料值并排对比，默认保留网站内容、勾选才改写）、**未识别的空框**（仅提示，留给逐个点填）；敏感字段默认不勾、带 🔒 标记，可整体撤回，你手动改过的内容不会被覆盖。
- **Excel 往返**：导出“每分类一表”的 .xlsx（禁公式、防 Excel 改写前导零与日期），改完导回；支持小师弟求职 v2 工作簿一键迁移。
- **模板 + 任意 AI 填表**：「导出 → 空白模板」下载结构完整的空模板，连同简历原文发给任何 AI（对话式或 Excel 熟练均可），让 AI 按「填写内容」列填写后导回——**不依赖插件做任意 Excel 智能识别，也就不会有“我的表不认得”的失败场景**（导出时插件内附给 AI 的指令示例）。
- **AI 按 JD 定制**（可选）：配置任一 OpenAI 兼容接口（DeepSeek / 阿里云百炼 / 智谱 / Kimi / 硅基流动 / OpenAI），粘贴岗位 JD，AI 逐条改写你已填的**非敏感**字段；只改写、不编造，逐条人工采纳前可再编辑，采纳前自动存历史快照。
- **备份**：JSON 明文备份 / AES-GCM 口令加密备份 / 最近 3 份本地历史快照。

## 安装（开发者模式）

1. 从 [Releases](https://github.com/HollyLab0529/PocketCV/releases) 下载最新 zip 并解压（或 clone 本仓库）；
2. Chrome 打开 `chrome://extensions`，右上角开启「开发者模式」；
3. 「加载已解压的扩展程序」选择解压后的目录；
4. 快捷键 `Alt+Shift+P` 或点工具栏图标打开侧栏。

## 快速上手

1. 打开侧栏 → 点侧栏底部「编辑资料」进入管理页，录入资料（或先「导出 → 空白模板」走模板/AI 路线）；
2. 打开任意招聘网页的表单，点一下要填的输入框；
3. 侧栏中该字段旁点「填入」；填错点「撤销填写」。

### 用模板让 AI 帮你填

1. 「导出 → 空白模板」下载 `PocketCV-资料表-模板.xlsx`；
2. 把模板和简历原文一起发给你的 AI，说：“请把我的简历信息填入这份表格每个工作表的『填写内容』列，保持行、列与工作表结构完全不变，缺失的信息留空、不要编造”；
3. 保存 AI 的结果为 .xlsx，回到插件「导入」。（导出空白模板时插件内也会显示同样的提示。）

### AI 按 JD 定制

侧栏「AI 定制」→「打开 AI 设置」填入服务商与 API Key（仅存本机）→ 粘贴 JD → 生成建议 → 勾选采纳。敏感字段全程不发送；空字段不会被代填。

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `storage` | 把资料保存在本机 `chrome.storage.local` |
| `activeTab` + `scripting` | 仅在你点击“连接/填入”时向当前标签页注入填写脚本，不读网页数据 |
| `sidePanel` | 侧栏界面 |
| `clipboardWrite` | “复制”按钮把单个字段值写入剪贴板 |
| 六家 AI 域名 | 仅当你配置并主动使用“AI 定制”时，从后台把所选非敏感字段发往你指定的接口 |

详见 [PRIVACY.md](PRIVACY.md)。

## 目录结构

```
manifest.json        # MV3 清单（无内容脚本常驻权限）
background.js        # Service Worker：存储路由 + 填写调度 + AI 转发
bridge/content.js    # 注入式填表引擎（令牌防错位/受控组件/撤销）
src/domain/model.js  # 资料模型与校验
src/infra/           # storage（乐观并发）/ zip / xlsx / vault（AES-GCM）
src/ui/              # panel 侧栏 + manager 管理页（同一套代码双形态）
tests/               # 纯浏览器跑的测试页（无需构建）
```

## 测试

```bash
node --check background.js bridge/content.js src/ui/app.js   # 语法
# 任一起静态服务后浏览器打开：
# tests/fill-engine.test.html   填表引擎 15 项
# tests/background-route.mjs    后台表单核对路由 14 项（node 直接运行）
# tests/mock-form.html          网申表单联调页（解析正确/解析错/未解析/特殊控件四区）
# tests/xlsx.test.html          Excel 导入导出 17 项
# tests/period5.test.html       模板与 AI 填表闭环 17 项
python3 -m http.server 8765
```

## 反馈

感谢使用口袋简历！🎉 遇到问题、适配了新网站，或只是想说一句"好用"，都欢迎到 [Issues](https://github.com/HollyLab0529/PocketCV/issues) 聊聊；插件内「更多 → 反馈问题 / 建议」可直达。每一个 Issue 都会被认真读。为保护隐私，本项目不提供维护者邮箱，也不在 Issue 之外收集任何反馈。

## License

MIT © 2026 骑着月亮去滑雪 (GitHub)
