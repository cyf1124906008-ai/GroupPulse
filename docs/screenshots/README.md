# 合成界面截图 / Synthetic screenshots

这些 PNG 由 GroupPulse 自身的原生测试程序在 macOS GitHub Actions runner 中，从实际 Electron 渲染窗口直接保存，尺寸 1440 × 1000。没有后期拼接或修改界面内容。

数据由 `scripts/fixture.cjs` 生成，包含虚构群名、演示账号、报价和消息；没有使用真实聊天或 API 密钥。

生成记录：[原生截图测试](https://github.com/cyf1124906008-ai/GroupPulse/actions/runs/41545469239)，源提交 `a64204f13a280fc1202804147d44db85603601b9`。后续文档提交只复制这些原始截图。

- `overview-zh.png`：中文概览。
- `overview-en.png`：英文概览。
- `overview-dark.png`：英文深色主题。
- `market-zh.png`：供需搜索、高亮及发送者来源面板。
- `prices-zh.png`：报价分类、命中原句和来源。
