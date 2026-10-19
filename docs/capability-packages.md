# DSH WorkBuddy Project 项目与能力库

开发版 0.3.0 使用完整能力包和 JSON 项目声明。页面、模型管理工具和 `/project` 命令共用同一服务。旧 `project.yml`、单文件专家、YAML MCP 声明和裸名称引用不再读取。

## 团队 Git 仓库

```text
library.json
experts/<id>/.codebuddy-plugin/plugin.json
experts/<id>/agents/<agentName>.md
experts/<id>/skills/<skill>/SKILL.md        # 可选
experts/<id>/avatars/                     # 可选
skills/<id>/SKILL.md
skills/<id>/scripts/ references/ assets/  # 可选
rules/<id>/RULE.md
connectors/<id>/connector.json            # 管理元数据；导入市场包时可缺省
connectors/<id>/mcp.json                   # MCP 或 CLI 二选一
connectors/<id>/cli.json
connectors/<id>/skills/                   # 配套技能，可选
projects/<template>/project.json
projects/<template>/experts/ skills/ rules/ connectors/  # 模板自带能力，可选
```

`library.json` 保存团队名称和描述；Git 仓库地址、同步策略保存在本机的 `projects/.team-libraries.json`。设置页支持启动同步、每日指定时间同步和手动同步。同步使用快进合并，有未提交改动或分支分歧时报告错误，不覆盖修改。

「能力库」顶部统一列出本地、已注册项目和共享来源，支持按来源与类型筛选；共享资源库顶部横栏仅展示已连接库数量与添加按钮；点击数量打开管理弹窗，库列表、同步、编辑与删除均在弹窗中操作，能力清单独占全宽。输入 Git 仓库地址后显示同步设置。未配置资源库时仍可新建能力，默认保存在本地；也可保存到已有项目的 `.dsh/` 目录。外部安装来源支持只读查看，避免直接修改已安装包。项目模板集中在「项目」页，可用模板填充新建项目表单。

资源库卡片支持删除注册配置，移除其可选能力和模板并停止自动同步，保留本地检出文件与项目已经锁定的能力版本。默认配置中的资源库也会记录删除状态，重启后不会自动恢复；可以通过“添加资源库”重新注册。同步期间暂不能删除。

已有相对路径头像允许最大 2 MB，保留路径与符号链接边界检查；编辑器新上传图片仍限制为 256 KB。

专家兼容 `.codebuddy-plugin/plugin.json` 和 `.workbuddy-plugin/plugin.json`。`agentName` 选择 `agents/<agentName>.md`；仅声明一个 `agents` 文件时可以省略 `agentName`。`expertType: "team"` 仍是一个专家条目，仅加载声明的入口，包内成员不展开为项目的多位专家。主专家的包内技能自动启用；其他已选专家形成按需方法论卡。`skills` 在专家清单中是包内相对目录列表；可用 `connectors` 声明带来源的连接器引用。

技能保留完整目录，支持作用域路径，例如 `skills/@owner/review/SKILL.md`。遇到包边界后停止扫描，参考资料中的 `SKILL.md` 不会重复列为能力。支持标准 YAML frontmatter。

连接器使用 JSON，页面和项目字段统一称为 `connectors`。`connector.json` 示例：

```json
{
  "id": "search",
  "name": "搜索连接器",
  "description": "搜索资料",
  "version": "1.0.0",
  "icon": "assets/icon.png",
  "type": "mcp"
}
```

`mcp.json` 保持 WorkBuddy 的 `mcpServers` 结构，一包可以声明多个服务：

```json
{
  "mcpServers": {
    "search": {
      "type": "streamableHttp",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${SEARCH_TOKEN}" },
      "timeout": 60000
    },
    "local": {
      "type": "stdio",
      "command": "node",
      "args": ["server.mjs"],
      "env": { "TOKEN": "${LOCAL_TOKEN}" }
    }
  }
}
```

HTTP 与 stdio 由 DSH 原生 MCP 桥接器执行。stdio 默认工作目录是已锁定的包目录，脚本随包缓存。配置值中的 `${VAR}` 在宿主加载时读取本机环境变量，编译物保存表达式。原生 DSH 连接器使用稳定的宿主引用，授权配置留在宿主。CLI 包保留 `cli.json`，将其配置文件位置提供给模型，挂载附带技能，通过终端调用本机 CLI；不会自动安装 CLI 或迁移 WorkBuddy 授权。当前 MCP 桥接器不支持 SSE，相关包明确显示不可用。

编辑已保存项目时可点击“检查连接器”，按项目锁定的配置执行握手和工具发现，不调用业务工具或修改项目。页面逐项报告授权缺失（401）、权限不足（403）、连接中断、超时、DNS/TLS 故障或不支持的工具定义；缺少环境变量时先报告变量名称，不发送空凭据。挂载错误也保留具体原因，检查结果不会将失败的连接器标为可用。

市场中的 `mcp.json` 只声明服务端点，不包含个人授权。需要 OAuth 的服务（如腾讯文档）不会因选中或同步自动登录；当前 DSH 桥接器未实现交互式 OAuth。已有 Bearer 凭据时，可在包中声明环境变量形式的 `Authorization` 请求头，由宿主本地提供对应变量，或选择已配置授权的 DSH 本地连接器。凭据不应写入共享 Git 仓库。

## 项目与模板

工作项目声明位于 `<工作目录>/.dsh/project.json`：

```json
{
  "version": 1,
  "id": "review",
  "name": "评审项目",
  "instructions": "先核实证据，再给出结论。",
  "experts": ["team:experts/reviewer"],
  "rules": ["team:rules/engineering"],
  "skills": ["personal:skills/review"],
  "connectors": ["team:connectors/search"]
}
```

指令始终是文本，形如 `./instructions.md` 的字符串也保持原样。其他选项仅接受 `来源:类型/包ID`，不接受路径、裸名称或内联服务配置。来源包括团队库名、`project`、`personal`、`agents`、`workbuddy`、`runtime` 和已挂载技能源。团队库名不能使用这些保留名称。

项目自有能力在 `.dsh/experts`、`.dsh/skills`、`.dsh/rules`、`.dsh/connectors`，采用相同包结构。默认还会发现 DSH 本地能力、已挂载技能，以及本机 WorkBuddy 的专家、技能和连接器市场包。发现 WorkBuddy 配置不意味着拥有其授权；用户凭证目录不会导入。

项目模板在 `projects/<id>/project.json`，采用相同声明。选择模板会填写指令与全部能力选项，保留用户已经填写的工作目录、名称和 ID。创建时复制模板自带能力并记录 `.dsh/template.json`。模板的 ID 必须与目录名一致。

## 固定版本

项目编译时将整个能力包保存为内容寻址快照：

```text
<DSH_HOME>/capabilities/cache/<sha256>/
<DSH_HOME>/capabilities/installed.json
<DSH_HOME>/projects/<id>/capabilities.lock.json
<DSH_HOME>/projects/<id>/agent.cordis.yml
<DSH_HOME>/projects/<id>/preset.yml
```

版本摘要覆盖包内全部文件，包括脚本、图标和附带技能。Git 同步只改变源库和可选目录，保存或重编译已选项目保持锁定版本；新增选项会加入新的快照。运行 `/project upgrade <id>` 才使用最新源内容。源包删除后，缓存完整的项目仍可重编译。缓存被改动或缺失会报错，不能静默退回源库。预览不会写入缓存或锁文件。

页面按条目展示卡片，编辑在弹框完成。能力包编辑器可以选择包内文本文件；新建专家和连接器会补齐清单。Git 提交前在临时目录验证完整包，创建评审分支并推送，保持原检出分支。图片路径相对整个包解析；支持 Emoji、PNG/JPG/GIF/WebP 和静态 SVG，大小上限 256 KiB。

项目编辑页保留能力选择、保存并编译、连接器检查与删除，不展示专家定义或技能内容预览。保存会自动编译并校验；编译预览、重新编译与版本升级可在宿主会话分别运行 `/project preview <id>`、`/project apply <id>`、`/project upgrade <id>`。

项目卡片采用紧凑两列布局，窄容器自动切为一列。能力库清单使用“专家 / 技能 / 规范 / 连接器”分类 Tab，每次显示一个分类，支持分类计数、搜索与方向键切换。

## 验证

```sh
npm test
npm run test:host
WB_UI_PACKAGE_JSON=/path/to/react-jsdom/package.json npm run test:ui
```

单元测试覆盖包扫描、专家入口、资源完整性、JSON 声明、版本固定、升级、Git 同步和路径边界；宿主测试通过真实 DSH 启动、HTTP/stdio MCP 调用、模板完整复制、能力编辑验证和 Git 分支提交推送验证；页面测试覆盖选择、模板填充、版本升级和包内文件编辑。
