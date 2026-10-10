# DSH WorkBuddy Project

为 DeepSeek Harness 按项目配置专家、技能、规则与连接器，复用项目模板，并可接入共享能力库。

Configure DeepSeek Harness projects with experts, skills, rules, connectors, reusable templates, and optional shared capability libraries.

包名与仓库名：`dsh-workbuddy-project`。当前版本为发布准备版，尚未发布到 npm 或提交市场收录。

## 功能

- **项目**：绑定工作目录、项目指令和所选能力，保存并编译为 DSH preset。
- **专家**：首位专家作为主专家加载，其他专家提供按需方法论卡；专家团按单个入口加载。
- **完整能力包**：专家、技能、规范、连接器保留完整目录及附带文件；项目能力选择器展示本地与共享来源。
- **能力库**：添加本地资源库或 Git 资源库，浏览专家、技能、规范和连接器，复用项目模板。
- **连接器**：HTTP/stdio MCP 桥接、本机 DSH 连接器引用和 CLI 包；检查连接、授权要求与工具发现结果。
- **固定版本**：项目锁定能力内容，资源库同步不会自动升级已保存项目；显式升级后使用新版内容。

个人使用不需要团队账号、管理平台或 Git 仓库。Git 同步与贡献操作需要本机 Git 及仓库访问资格。

## 运行要求

- Node.js >= 22。
- 兼容当前 `package.json` peer 范围的 DSH；本轮验证使用 DSH `0.2.0-rc.2`。
- Web 界面提供「项目」「能力库」两个设置入口；命令和模型管理工具也支持无界面宿主。

## 安装

目前可先打包并从本地制品安装：

```sh
npm pack
dsh plugin --profile web add /absolute/path/dsh-workbuddy-project-0.3.0.tgz
```

如果以 npx 运行 DSH，命令前缀可换为 `npx --no-install @deepseek-ai/dsh`。安装后重启目标 DSH profile 并刷新界面。

也可从[项目仓库](https://github.com/matiomlei/dsh-workbuddy-project)安装：

```sh
dsh plugin --profile web add github:matiomlei/dsh-workbuddy-project
```

当前代码已上传 GitHub，尚未发布 npm 包。npm 发布成功后才可使用 `dsh plugin --profile web add dsh-workbuddy-project`。

## 第一次使用

1. 打开设置 → 项目 → 新建项目，选择已有工作目录并填写项目指令。
2. 按需选择专家、技能、规范和连接器。没有能力包时，也可先创建仅含指令的项目。
3. 保存并编译；配置连接器的项目可点击「检查连接器」。
4. 新建会话，在 preset 选择器中选中该项目。已有会话保留创建时配置。

默认项目注册与编译目录是 `<DSH_HOME>/projects`；未设置 `DSH_HOME` 时使用 `~/.dsh/projects`，也可在插件配置中显式指定 `projectsRoot`。工作目录里的项目声明保存在 `.dsh/project.json`。

## 体验示例模板

在 DSH 插件配置中，将 `libraries` 设为 `[{"name":"examples","path":"/absolute/path/to/dsh-workbuddy-project/examples/library"}]`（替换为本机实际路径）。随后在「项目」新建页面选择「代码评审」或「资料研究」模板。模板自带专家，无外部连接器或凭据依赖。界面添加新 Git 资源库时需要仓库地址；预配置本地示例库无需 Git 同步。

能力库当前管理已注册资源库中的能力；用户已有的本地技能和 DSH 连接器在项目能力选择器中发现。详见[能力包格式与运行约定](docs/capability-packages.md)。

## 命令

```text
/project list
/project preview <id>
/project apply <id>
/project upgrade <id>
```

库同步与项目升级是两个动作；保存现有项目保持已锁定版本。

## 当前边界

- 专家卡不代表独立多智能体并行执行；共享资源库不提供成员角色、共享对话或任务协作服务。
- 当前 MCP 桥接支持 HTTP 与 stdio，SSE 不支持。OAuth 交互登录尚未实现，可引用已授权的本地 DSH 连接器或使用本机环境变量凭据。
- CLI 包不自动安装本机命令。发现 WorkBuddy 包不代表导入其账号授权。
- 包编辑器「提交为 PR」目前创建并推送 Git 评审分支；不会自动在托管平台建立 PR。
- 发布版与旧开发插件应分别在不同 profile 验证；二者都提供 `/project` 命令和项目 preset，请避免在同一 profile 同时启用。

## 开发与发布验证

```sh
npm install
npm test
npm run test:host
npm run test:ui
npm run check:package
```

宿主测试通过 `WB_DSH_NODE_MODULES` 指定已安装 DSH 的 `node_modules`；默认查找 `~/.dsh/profiles/node_modules`。UI 测试使用开发依赖，也可通过 `WB_UI_PACKAGE_JSON` 指向已有 React/jsdom 环境。

发布准备项和待补材料见[发布清单](docs/releasing.md)。
