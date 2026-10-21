# 内网 Git 插件仓库与 DSH 0.2.1-rc.2

本指南按 npm 发布的 DSH `0.2.1-rc.2` 的 plugin-market、plugin-market-index 和 plugin-manager 实现编写。插件版本为 `0.3.1`。

## 1. 准备两个仓库

在内网 GitLab/Gitea 等服务创建：

- `tools/dsh-workbuddy-project`：插件代码，根目录必须包含 `package.json`、`lib/`、`cordis.patch.yml` 等发布文件。
- `tools/dsh-plugin-market`：市场索引，根目录放 `index.json`。以后其他插件也可以加入同一索引的 `plugins` 数组。

本开发工作区的 `release/dsh-workbuddy-project/` 是完整独立插件仓库。只复制该目录的发布内容到内网插件仓库，排除 `.git`、`node_modules`；不要把整个开发工作区、`.dsh`、个人项目和能力库推上去。

在内网插件仓库完成代码提交，再执行（示例域名和命名空间需替换）：

```sh
git add .
git commit -m 'Release 0.3.1 for DSH 0.2.1-rc.2'
git tag v0.3.1
git push origin main --tags
git rev-parse HEAD
```

建议把 `package.json` 的 repository/homepage/bugs 改为真实内网地址后再提交。安装来源由索引 `source` 决定，以上展示字段不决定下载位置。

## 2. 生成索引并发布

在**已提交的内网插件仓库根目录**运行随仓库提供的生成器，把索引写到另一个仓库：

```sh
node scripts/generate-market-index.mjs https://git.example.com/tools/dsh-workbuddy-project.git <上一步的40位commit> ../dsh-plugin-market/index.json
```

生成器读取插件的真实包名、版本和 `engines.dsh`，写入格式 1 索引，且拒绝覆盖已有文件。更新已有市场时，将新生成的版本对象合并进相应插件的 `versions` 数组，保留其他插件和历史版本；同一插件内版本不能重复。Git 来源必须是 HTTPS 仓库地址与小写 40 位 commit，不能用 tag 或分支名代替 commit。

索引最小结构示意（`commit` 必须替换成真实值）：

```json
{
  "format": 1,
  "title": { "en": "Internal DSH Plugins", "zh": "内网 DSH 插件市场" },
  "plugins": [{
    "name": "dsh-workbuddy-project",
    "title": { "en": "DSH WorkBuddy Project", "zh": "项目与能力库" },
    "versions": [{
      "version": "0.3.1",
      "publishTimestamp": 1792540800,
      "engines": { "dsh": "~0.2.1-rc.2" },
      "source": {
        "type": "git",
        "url": "https://git.example.com/tools/dsh-workbuddy-project.git",
        "commit": "替换为真实的小写40位commit"
      }
    }]
  }]
}
```

`publishTimestamp` 是发布时的 Unix 秒，生成器自动填写。所有多语言文本必须包含 `en`。

把 `index.json` 提交到市场仓库并推送。取得它的 **Raw HTTP/HTTPS URL**，例如：

- GitLab：`https://git.example.com/tools/dsh-plugin-market/-/raw/main/index.json`
- Gitea：`https://git.example.com/tools/dsh-plugin-market/raw/branch/main/index.json`

最终 URL 必须直接返回 UTF-8 JSON 和 HTTP 200，不能返回登录页、文件浏览页或重定向。可用 `curl -i <Raw地址>` 检查。DSH Host 获取索引，不会沿用浏览器的登录 Cookie；索引配置也没有认证 Header 字段，URL 禁止内嵌账号密码或 `#fragment`。最省事的内网方案是让索引静态地址可由内网 DSH 主机直接读取；代码仓库则通过本机 Git credential helper 配置读取权限。若 Git 平台 Raw 地址不能直接提供 JSON，可将同一文件同步至内网 Nginx 静态路径。

## 3. 同事在 DSH 中安装

1. Web 侧栏打开「插件」，点击「实验性插件」旁的「更多」，启用「自定义插件市场」。
2. 打开「发现」，添加上面的 **index.json Raw URL**。此处不是 `.git` clone 地址。
3. 搜索 `dsh-workbuddy-project` 或「项目与能力库」，选择 `0.3.1` 安装。完成后按 DSH 提示应用或重启，刷新页面。
4. 在「设置 → 项目／能力库」中使用插件。

不用市场也可直接安装：

```sh
dsh plugin --profile web add -w 'git+https://git.example.com/tools/dsh-workbuddy-project.git#v0.3.1'
```

内网程序目录使用本地 DSH 时，可将 `dsh` 换成 `npx --no-install dsh`。Windows PowerShell 同样支持这条安装命令。

新版市场的 Git 条目会转换成 `git+https://...git#<commit>` 交给包管理器安装；展示用的 `repository.url` 不参与安装。

## 4. 内网依赖、升级与验收

Git 能提供源码，但插件的 `yaml@2.9.1` 以及包管理器所需依赖仍需可用。完全隔离网络应配置内网 npm 镜像（在 DSH profile 所在包管理器环境中配置），或使用项目的 Windows 离线安装包。仅把 Git 仓库搬到内网不等于依赖已离线齐备。

从旧版升级前退出目标 DSH，并备份 `<DSH_HOME>/projects`、`<DSH_HOME>/capabilities`、目标 profile 配置和工作项目的 `.dsh`。本次发布保留原发布版包名、服务名和 API 路径。DSH `0.2.1-rc.2` 的市场能显示有新版，但更新已安装市场插件仍需先卸载旧包再安装新版本；插件项目与能力文件独立于 npm 包，升级后在项目页重新保存并编译，让生成的 preset 使用当前代码与接口。使用离线脚本安装过开发包 `dsh-plugin-workbuddy-projects` 的机器，应先停用旧开发插件，再启用正式包，避免两套管理入口同时挂载。

验收：创建仅含指令的项目并保存编译，在新会话中选择该项目 preset；再测试一个技能和一个实际业务连接器。现有会话不会自动切换 preset。HTTP 连接器授权和模型端到端调用仍需在内网真实服务上验证。

插件市场与本插件的「共享资源库」是两种仓库：前者安装插件代码；后者同步 experts/skills/rules/connectors/projects 能力内容。能力库的 Git 地址应在「设置 → 能力库」中添加。

## 源码依据

以 `0.2.1-rc.2` 发布包内 README 和校验器为准：`@deepseek-ai/dsh-experimental-plugin-market-bundle`、`@deepseek-ai/dsh-plugin-market`、`@deepseek-ai/dsh-plugin-market-index`、`@deepseek-ai/dsh-plugin-manager`。可在内网安装目录的 `node_modules/@deepseek-ai/` 查阅对应 README.zh.md。
