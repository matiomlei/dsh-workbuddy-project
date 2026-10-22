# 发布与收录

本仓库是独立发布包 `dsh-workbuddy-project`，运行时版本由 `package.json` 决定。npm 发布、GitHub Release 和插件市场收录是独立步骤；市场收录需要维护者审核。

## 0.4.0-preview.4 产品预览

本分支交付源代码、固定依赖的离线制包脚本和 Windows 安装器，不自动发布 npm、标签或 GitHub Release。当前预览的检查结果见 [验证记录](product-preview-validation.md)。

```sh
npm ci --ignore-scripts --legacy-peer-deps
npm run build:client
npm test
npm run test:delivery
npm run check:package
npm run prepare:offline
```

`npm pack` 是普通在线插件制品；`prepare:offline` 的 tgz 才携带普通依赖。两种制品不要混淆。离线包的 host peer 通过安装时 junction/symlink 复用目标 DSH 安装，包内不放另一份 Cordis/DSH。SHA-256 校验文件与制品一起交付。

### 重现隔离安装验收

先制作离线包。以下准备工具只用于开发验证，目标目录必须不存在：

```sh
node test/delivery/prepare-installed-host.mjs <new-test-root> dist/dsh-workbuddy-project-0.4.0-preview.4-offline.tgz <DSH-package-directory>
```

工具解压并使用真实安装 helper 配置新 profile、验证宿主 peer，额外放入一个**仅用于测试**的确定性模型适配器。按输出设置 `DSH_HOME=<root>/home`，启动 `dsh --profile web --patch <root>/test.patch.yml --no-open --port 0` 并将输出保存到 `<root>/host.log`。再运行：

```sh
node test/delivery/check-installed-host.mjs <root>
node test/delivery/check-starter-host.mjs <root>
```

正常路径覆盖共享库专家/Skill/MCP/规范的实际加载调用、基础工具范围、能力快照、模型选择、模板发布、项目绑定、Agent 文件交接、人工验收放行、补丁应用与版本复用。测试不需要外部模型调用，不能代替真实模型效果或 Windows 实测。

### 预览分支交付

小步提交到 `codex/product-delivery-preview`，推送源代码和制作脚本。`dist/` 为本机生成制品，不提交到 Git；可在外部 Windows 准备机从分支重新制作，再按 [Windows 指南](windows-preview.md) 当作封闭环境安装。

## 0.3.1 验证（DSH 0.2.1-rc.2）

- 单元、库同步、宿主和 UI 测试通过；真实基础服务下的项目 preset 创建、激活、更新和移除验证通过。
- 格式 1 索引生成结果通过同版本 DSH 的官方 parseMarketIndex 校验器。
- npm 包检查通过，制品包含运行入口、DSH bundle patch、文档和示例，不包含用户数据、凭据、依赖目录或开发测试。
- 在独立临时 `DSH_HOME` 中从 0.3.1 tgz 安装成功，Web profile 配置组合器发现插件。
- 宿主测试完成 HTTP/stdio tools/call、连接错误分类、模板复制与编译、能力编辑和 Git 同步。

自动化验收不包含真实模型对话、OAuth 连接器登录或所有设备的视觉检查。当前连接器与协作边界见 README。

## 历史 0.3.1 发布流程（旧能力管理版本）

```sh
npm test
npm run test:host
npm run test:preset
npm run test:ui
npm run check:package
npm pack
```

宿主测试使用 `WB_DSH_NODE_MODULES` 指向已安装 DSH 的 `node_modules`，UI 测试可使用 `WB_UI_PACKAGE_JSON` 指向已有 React/jsdom 环境。正式包应在干净 profile 中实际安装：

```sh
DSH_HOME=/absolute/path/to/test-home dsh plugin --profile web add -w /absolute/path/dsh-workbuddy-project-0.3.1.tgz
```

确认版本、发布说明与检查结果后，提交代码并推送 `v0.3.1` 标签，发布同一 tgz 到 npm 和 GitHub Release。发布后核验 npm 的版本、完整性摘要、GitHub 标签和 Release 附件。后续修复使用新版本，勿替换已发布制品。

## 自定义插件市场

DSH 0.2.1-rc.2 的发现页读取用户配置的格式 1 JSON 索引。内网 Git 部署、索引生成、Raw URL、依赖和升级步骤见 [内网发布指南](intranet-market.md)。新版自定义市场没有默认官方索引；第三方目录收录和 npm/Git 发布互相独立。

## 独立开发

初始内容由上级开发仓库 `scripts/release/prepare.mjs` 生成。本仓库可独立维护，不需要该生成器或父目录。生成器重复执行会校验已有文件，不会静默覆盖修改；后续同步应逐项合并并重新验证。
