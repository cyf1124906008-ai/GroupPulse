GroupPulse 2.0.0 是独立构建的本机群聊信息工作台，提供简体中文 / English 界面。

- 独立主程序、SQLite 快照与索引、聊天 / 朋友圈 / 通讯录界面；无需原程序安装包。
- 搜索按钮、关键词高亮、长消息命中句预览、发送者身份与原文上下文定位。
- 本机群聊活跃度、词频、自定义关键词、供需分类与候选配对。
- 折扣、每刀单价、明确倍率、套餐档位和金额周期分别统计，保留全部来源。
- 头像、DAT 图片、SILK 语音、MP4 与 WXGF 首帧读取；独立媒体组件及对应许可 / 源码随包附带。
- 自选模型 API，发送前检查目标与有限摘录、明确确认；基础统计无需模型。
- CSV / JSON 全量筛选导出、HTML 年度报告、收藏、深浅色主题与应用锁。

下载 `macOS-arm64.zip`（Apple Silicon）或 `Windows-x64.zip` 并完整解压。Windows 运行 `GroupPulse/GroupPulse.exe`；Mac 打开 `GroupPulse.app`。两个平台均附 SHA-256 与原生测试报告。当前包未使用商业代码签名，Mac 未做 Apple 公证，首次打开可能需本人完成系统确认。

独立版使用自己的 `GroupPulse` 数据与系统存储身份，不自动读取旧版钥匙串。首次请在软件中选择本机微信 4.x 数据源或完整明文副本，并重新填写模型 API 设置。静态副本只更新到副本自身的时间；持续更新需要仍在写入的账号源及有效本机密钥。旧数据不会被删除。

只分析这台电脑保留的内容，不从服务器恢复未缓存、已删除或过期资源；规则识别与 AI 结论均需核对原文。Windows 原生测试使用合成数据和同用户 DPAPI，不能据此保证所有实际微信版本的密钥取得流程。

项目代码按 **PolyForm Noncommercial 1.0.0** 公开，允许许可范围内的非商业使用、修改和分享；商业用途需另行取得适当授权。第三方组件保留各自许可。完整功能、八语介绍与合成截图见仓库 README。

---

GroupPulse 2.0.0 is an independent desktop workspace for local WeChat records, keyword tracking, supply and demand, price evidence and optional AI. Chinese and English UI, light/dark themes, complete filtered exports and source-linked results are included.

Choose the macOS Apple Silicon or Windows x64 archive, extract everything and follow the bundled README. First import a supported local data source and configure your own model API if needed. Static snapshots do not fetch live server history. OS confirmation may be required for unsigned/ad-hoc packages.

Source available under **PolyForm Noncommercial 1.0.0**; third-party components retain their own licenses. All documentation screenshots and CI tests use synthetic data. No private chat records, account keys or model keys are distributed.
