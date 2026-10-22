# Windows 路径检查：preview.6

日期：2026-10-22。范围：WorkBuddy 自有运行代码、内置标准模板 MCP、安装/制包脚本，并检查所用 DSH 与 MCP SDK 的加载、启动方式。

## 已发现并修复

| 位置 | 原行为与影响 | 修复与验证 |
| --- | --- | --- |
| 本机 Git 能力库地址 | 在判断绝对路径前拒绝所有空白，`D:\团队 能力库\origin.git` 无法登记 | 绝对路径允许空格，控制字符和远程地址空白仍拒绝；真实中文/空格 Git 源 clone、更新通过 |
| 能力库来源定位 | 原生路径与写死 `/` 的前缀比较，Windows 路径不能反查能力库 | 原生相对路径判断，输出标准 `/` 引用；实测代码的 Win32 语义覆盖混合分隔符、盘符大小写、尾部分隔符 |
| 宿主 MCP 配置识别 | 本地桥入口正则只识别 `/`，原生 Windows 入口未计入本地 MCP | 识别前统一入口分隔符，覆盖原生盘符路径、file URL、POSIX 路径 |
| 文件范围判断 | 多处 `root + sep` 前缀比较在盘符大小写或盘根目录时误拒绝，涉及包、图标、贡献、画布资源、仓库上下文 MCP | 以 `path.relative` 判断范围；跨盘、跨共享目录、上跳、相邻同名前缀仍拒绝。MCP 实际源码另测大小写、盘根、跨盘与敏感路径 |
| 能力库重复登记与同步锁 | `D:\Library` 和 `d:/Library` 字符串不同，可被当作两个目录 | 按原生路径身份比较，目录别名共用锁；回归覆盖重复登记和同步状态 |
| Git 深目录 | 私有工作树叠加业务目录后可能超过传统 Windows Git 路径限制 | 各 Git 调用显式传 `-c core.longpaths=true`，不修改全局配置；随包自检创建超过 260 字符路径并验证 checkout、读取和快照。Windows 实际结果仍须目标机运行确认 |

前两次已修复的问题继续保留回归：扫描原生相对路径先转换为包引用；节点模块用 file URL 导入并预检原始加载错误。包引用本身仍禁止反斜杠、绝对路径、盘符相对路径及 `..`。

插件级修复重启后用于新运行。内置 MCP 脚本属于不可变能力快照：旧模板要获得该脚本的范围判断修复，需要在节点能力设置中显式升级并发布新版本，或重新点击“使用标准研发模板”，再把项目绑定到新版本；升级插件不会替换历史模板/运行快照。

## 已检查的其它链路

- 自有运行代码的所有动态文件导入均经 `new URL(..., import.meta.url)` 或 `pathToFileURL`，没有发现仍把原生盘符路径直接交给 `import()` 的入口。
- Git 操作以参数数组传递目录；未把用户路径拼接成 shell 命令。补丁内容来自 Git blob，文件列表使用 NUL 分隔。
- MCP SDK stdio 使用 `cross-spawn`，已有 Windows 命令适配；本插件没有另加 shell 包装。内置仓库 MCP 无 npm 下载依赖。
- PowerShell 安装器使用 `Join-Path`、文件操作使用 `-LiteralPath`；配置和 peer 链接由 Node helper 生成，file URL 转换已覆盖。安装器的 Windows 执行未在本轮发生。
- 固定 Workflow One 内核的相关路径模块使用原生 path API。本轮未修改其固定资源或校验值。

## 验证边界

本轮在 macOS / Node 25.6.1 上执行实际模块的 Win32 路径语义回归，并执行真实 Git、stdio MCP 和隔离 DSH 安装运行。语义回归使用虚拟机模块及映射文件系统，不是 Windows 内核实测。

随包提供 `scripts/check-paths.mjs`，安装后无需联网或模型配置即可运行：

```powershell
$pluginRoot = Join-Path $env:USERPROFILE '.dsh\profiles\web\plugins\dsh-workbuddy-project'
node (Join-Path $pluginRoot 'scripts\check-paths.mjs')
```

自定义 DSH_HOME/profile 时，将 `$pluginRoot` 改为实际插件目录。脚本只操作新建临时测试目录，生成自己的 Git 测试仓库、编译四阶段模板能力、调用内置 MCP、验证长路径代码交接，然后清理；不启动模型、不修改业务仓库或 DSH 配置。输出 JSON 含 `platform`、`nativeWindows`、`passed` 和失败步骤；退出码非 0 表示失败。自检通过不代表 PowerShell 安装、真实模型或外部构建工具链已验收。

UNC 的路径范围判断有语义测试；实际网络共享、文件锁、杀毒软件、ACL、各外部工具的长路径限制和 Windows shell 仍需实机验证。原启动器的 `cordis.yml` EPERM 也不能归因于本次插件路径修复；目前只确认用户的直接 Node 启动命令可用。
