# Windows 封闭环境验证：WorkBuddy 项目交付 0.4.0-preview.1

目标宿主：**DSH 0.2.1-rc2（npm 版本 0.2.1-rc.2）**，Windows 10/11，Node.js >=22.15（含 node:sqlite），Git for Windows。使用 DSH CLI 的 web profile，浏览器地址为本机 localhost。DSH 桌面壳暂未验证。

## 1. 在可联网的准备机制作插件离线包

准备机可以是 Windows、macOS 或 Linux。本插件的普通依赖是 JavaScript / WASM；制作过程不编译 Windows 原生模块。请安装目标 Node 版本后，在仓库根目录运行：

```powershell
npm ci --ignore-scripts --legacy-peer-deps
npm run build:client
npm run prepare:offline
```

生成 `dist/dsh-workbuddy-project-0.4.0-preview.1-offline.tgz`、同名 `.sha256`、`install-windows.ps1` 和本说明。离线包已包含固定依赖与画布资源。DSH 及其宿主依赖复用目标机已有安装，不包含在插件包内。

将这四个文件复制到验证机。**目标机安装和运行插件不执行 npm install、npx 或联网下载。** 模型请求仍需要可访问的模型服务；完全断外网时，请先在 DSH 中配置可访问的本地/内网模型。MCP、Skill 脚本及项目构建工具的运行依赖须由所在环境另行具备。

## 2. 在验证机安装

先关闭该 profile 的 DSH 进程。建议先使用单独的 `DSH_HOME`，与日常配置隔离；可先在这个测试 DSH 中配置模型并确认普通会话能工作。

```powershell
$env:DSH_HOME = 'D:\dsh-validation'
# 在此 home 下启动 DSH、配置模型后退出，再执行安装：
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 `
  -Archive .\dsh-workbuddy-project-0.4.0-preview.1-offline.tgz `
  -Profile web `
  -DshHome $env:DSH_HOME `
  -DshRoot 'D:\tools\dsh'
```

`-DshRoot` 为包含 `node_modules/@deepseek-ai/dsh` 的 npm 工程目录，或 DSH 包目录。若系统 PATH 中的 DSH 能自动定位，也可省略此项。脚本检查校验和、Node/DSH 版本、宿主依赖并合并 profile 配置；保留已有模型及资源库配置。插件安装在 `<DSH_HOME>/profiles/web/plugins/dsh-workbuddy-project`。宿主 peer 使用目录 junction 复用同一份 DSH，避免复制出第二份框架。

```powershell
# 保持相同的 DSH_HOME
 dsh --profile web --no-open
```

打开终端显示的 localhost 地址，侧栏点击 **项目交付**。应看到 **项目 / 工作流模板 / 能力库 / 运行记录**。原有设置页的“会话项目”仍用于普通会话 preset；业务交付项目使用侧栏的新入口。

## 3. 第一轮功能验证

1. **模型**：DSH 设置中选择一个实际可用的模型，普通对话成功。项目运行也使用该配置，节点可以单独选择模型。
2. **能力库**：新增本地专家、Skill、规范或 MCP 包；也可在资源库管理中添加内网 Git 能力库并同步。共享库不要求公网 GitHub。
3. **工作流模板**：新建模板，在画布任意增删节点和连接，配置任务提示词、运行输入。右侧逐个配置 Agent 的仓库角色、入口专家/专家团包、Skills、MCP、规范；可选择人工验收。能力列表支持搜索，编辑节点默认保留已有快照，显式勾选升级才替换能力内容。保存并发布 v1。模板不限于“需求分析、设计、编码、测试”。
4. **项目**：先手工 clone 一个或多个 Git 仓库并提交初始版本；新建项目，填写本机仓库根目录、别名和 ref。选择模板 v1，将模板仓库角色映射到项目仓库。
5. **运行**：输入需求并开始。打开运行记录观察 DAG、节点状态和输出。需要验收的节点应停在“待验收”，通过前下游不执行。填写验收说明，通过后应继续。
6. **交付物**：预览文件，下载所选节点的累计补丁；在另一个干净分支/仓库验证 `git apply --check` 后应用。累计补丁从本次运行固定的原始提交到该节点输出，包含上游已经接收的变更。
7. **版本复用**：编辑草稿发布 v2；原项目/旧运行仍固定 v1，项目显式更换后才使用 v2。尝试复制模板、JSON 导入导出、查看历史版本。

运行在私有 Git worktree 中完成，不自动提交到源仓库、不自动 push。源仓库未提交文件不进入运行；先提交希望参与运行的内容。每个 Agent 指定一个主仓库作为 cwd；多仓库项目通过不同节点角色分工。

## 4. 第一版边界

这是面向实际使用的**产品预览版**，不是成熟稳定版。已提供统一产品入口和正常交付路径；Windows 必须进行本机功能验证，macOS 上的通过不能替代 Windows 实测。

- 当前可执行节点为 Agent、JavaScript、输入、输出；画布其它高级节点尚未接入业务运行，发布时会提示。
- 专家团以一个能力包的入口专家加载，附带 Skill 一起提供；不在一个节点内再启动一个 Teams 多成员调度器。
- 完成条件先提供人工验收。hook、自动测试结果、产物规则和其它检查提供方仍为后续扩展；未配置验收的节点只表示执行完成。
- Git 仓库先在本机准备。自动 clone、远程协作调度、多人集中审批未接入。
- MCP 从能力包绑定；宿主原生 MCP 请先保存为能力包。外部连接器本身仍需环境网络与凭据，界面不分发凭据。
- 重启后可查看历史；有完整检查点的中断运行支持显式恢复，不确定的执行不自动重复。
- 当前每个节点的文件变更快照上限为 50 个文件、5 MB；文本预览上限为 256 KB。大批量修改应拆分节点，二进制文件可通过累计补丁交付。
- 普通运行沿用 DSH 文件访问和命令审批策略。若 bash/MCP 操作需要宿主批准，按 DSH 当前策略处理。

## 5. 升级、回退与反馈

安装器将旧插件和 `cordis.patch.yml` 放到 `<profile>/offline-backups/workbuddy-*`。失败会尝试自动恢复；手工回退时先停 DSH，用该目录中的旧插件和配置替换当前版本。新业务数据默认位于 `<DSH_HOME>/delivery`，旧会话项目位于 `<DSH_HOME>/projects`，回退不删除业务数据。junction 请用 Node 的 `fs.rmSync` 或 Windows 正确的 junction 删除方式移除，勿递归删除宿主目录内容。

反馈请包含 Node/DSH/Git 版本、失败步骤、界面报错和相关运行编号。不要直接公开模型密钥或 MCP 凭据。当前验证报告见 `docs/product-preview-validation.md`。
