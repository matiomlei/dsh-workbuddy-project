# 发布与收录

本仓库是独立发布包 `dsh-workbuddy-project`，运行时版本由 `package.json` 决定。npm 发布、GitHub Release 和插件市场收录是独立步骤；市场收录需要维护者审核。

## 0.3.0 验证

- 单元、库同步、宿主和 UI 测试通过。
- npm 包检查通过，制品包含运行入口、DSH bundle patch、文档和示例，不包含用户数据、凭据、依赖目录或开发测试。
- 在独立临时 `DSH_HOME` 中从 tgz 安装成功，配置组合器发现插件，Web 宿主启动成功。
- 通过真实宿主的已认证 API 创建仅含指令的项目，确认默认数据根目录与 preset 校验。
- 代码评审、资料研究模板均完成专家复制、依赖解析、保存编译及完整宿主 preset 校验。

自动化验收不包含真实模型对话、OAuth 连接器登录或所有设备的视觉检查。当前连接器与协作边界见 README。

## 发布流程

```sh
npm test
npm run test:host
npm run test:ui
npm run check:package
npm pack
```

宿主测试使用 `WB_DSH_NODE_MODULES` 指向已安装 DSH 的 `node_modules`，UI 测试可使用 `WB_UI_PACKAGE_JSON` 指向已有 React/jsdom 环境。正式包应在干净 profile 中实际安装：

```sh
DSH_HOME=/absolute/path/to/test-home dsh plugin --profile web add -w /absolute/path/dsh-workbuddy-project-0.3.0.tgz
```

确认版本、发布说明与检查结果后，提交代码并推送 `v0.3.0` 标签，发布同一 tgz 到 npm 和 GitHub Release。发布后核验 npm 的版本、完整性摘要、GitHub 标签和 Release 附件。后续修复使用新版本，勿替换已发布制品。

## 市场收录

收录目标为 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，市场客户端从该目录读取条目。按其 [贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/CONTRIBUTING.md) 添加单个文件 `data/plugins/matiomlei__dsh-workbuddy-project.yml`，分类使用 `tools`。

仓库声明 `dsh.bundle` 并包含真实代码，已添加 `dsh-plugin` topic。仓库于 2026-10-10 01:35:34 UTC 创建，需到 2026-10-11 01:35:34 UTC（北京时间 09:35:34）才满足创建满 1 天的 CI 门槛。提前提交的草稿 PR 需在到期后重新运行检查，再申请维护者审核；npm 与 GitHub 发布不受该门槛影响。

截图是市场可选材料。后续可在本仓库 `screenshots.json` 中声明 1–8 张真实截图，市场会随构建更新，无需修改目录 README。

## 独立开发

初始内容由上级开发仓库 `scripts/release/prepare.mjs` 生成。本仓库可独立维护，不需要该生成器或父目录。生成器重复执行会校验已有文件，不会静默覆盖修改；后续同步应逐项合并并重新验证。
