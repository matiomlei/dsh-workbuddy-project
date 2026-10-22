---
name: delivery-implement
description: 按方案实现与自检，用于标准研发交付工作流的编码实现阶段。
---

# 按方案实现与自检

先读取 requirements.md 和 design.md，检查目标模块及项目脚本，按计划修改实现与必要测试。调用仓库实际支持的测试、格式或构建命令，记录命令、退出码和摘要。验证失败必须修复或明确阻塞；不能靠删除用例或降低断言宣称通过。总结变更、AC 覆盖和交给独立测试的注意事项。

主要报告：`.delivery/outputs/implementation.md`。除报告外，按需求生成必要的代码和测试文件。
