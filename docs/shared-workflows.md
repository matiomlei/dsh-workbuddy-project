# 用 Git 管理共享资源和工作流

项目模式右上角的齿轮打开设置。资源库统一提供专家、技能、规范、连接器和工作流模板；能力库页面直接展示能力清单。

在设置中添加资源库名称、Git 地址和本机检出目录，选择手动、启动时或每日同步。Git 认证沿用本机凭据或 SSH 配置。更新已有干净检出时只做快进，不覆盖本地改动。

## 资源库目录

```text
team-resources/
  experts/
  skills/
  rules/
  connectors/
  workflows/
    software-delivery/
      workflow.json
```

完整的标准研发资源库位于 [examples/software-delivery/library](../examples/software-delivery/library)。可把该目录的内容作为团队资源仓库的根目录，提交到内网 Git，再在设置中连接。标准模板已放在 `workflows/software-delivery/workflow.json`，与它使用的四类能力一起维护；页面不再提供专门创建标准模板的按钮。随产品提供的 `delivery-starter` 也通过同一共享资源清单选用。

工作流文件使用 JSON，包含 `id`、`name`、可选的 `description` / `version`、`definition` 和可选的 `bindings`。`definition` 沿用普通工作流的 DAG、仓库角色、输入字段和质量策略。示例：

```json
{
  "id": "review",
  "name": "代码评审",
  "version": 1,
  "definition": {
    "graph": {
      "nodes": [{"id":"review","type":"agent","position":{"x":0,"y":0},"data":{"label":"代码评审","prompt":"读取变更并记录评审意见。","tools":["read"]}}],
      "edges": []
    },
    "repositoryRoles": [{"id":"main"}],
    "qualityPolicies": [{"nodeId":"review","required":true}]
  },
  "bindings": [{
    "nodeId": "review",
    "repositoryRole": "main",
    "capabilities": {
      "experts": ["./experts/reviewer"],
      "skills": [],
      "rules": [],
      "connectors": []
    }
  }]
}
```

`./experts/reviewer` 和 `experts/reviewer` 都表示当前资源库内的能力，选用时会转换为该资源库的实际名称，因此换一个检出目录或资源库名称仍可使用。显式的 `另一个库:skills/某技能` 表示跨库引用，需要同时连接对应资源库。能力必须实际存在且有效；选用时通过现有能力编译器固定内容哈希，不从其它机器复制缓存路径。

## 选用和更新

1. 在“工作流模板”点击“从资源库选用”，选择模板。
2. 系统创建独立的本地草稿，保存来源、资源版本和内容哈希，并固定每个节点的能力包。
3. 核对或编辑后发布，项目选择已发布版本并映射 Git 仓库。
4. 团队修改 Git 中的 `workflow.json`，提交、推送后同步资源库。更新会出现在共享清单，可再次选用为新草稿；已有草稿、已发布版本、项目绑定和运行快照保持原样。

浏览后源文件发生变化时，旧的选用请求会被拒绝，刷新清单后再选。文件导入和新建 DAG 仍可使用。此版通过同步和选用读取 Git 模板；修改共享源文件使用团队既有的 Git 提交和评审流程。
