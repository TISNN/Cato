---
name: cato-content-workbench
description: 在 Cato AI 内容工作台中检索资料和内容情报，并在用户确认后记录灵感或创建创作项目。
---

# Cato AI 内容工作台

先用 `cato_search_library` 或 `cato_search_intelligence` 获取依据，再给出建议。资料库检索返回摘要；需要完整正文时，用 `cato_read_library_document`。

`cato_capture_inbox_note` 和 `cato_create_content_project` 会写入 Cato。先向用户展示将写入的内容并取得明确确认；只有确认后才传 `confirmed: true`。不要把“帮我记一下”“创建一个”之外的模糊意图视为确认。

创建项目时，目标平台必须是小红书、公众号或抖音。若关联选题，先确认该选题已确认；不要自行创建或确认选题。

遇到令牌无效或 Cato 无法连接时，请提示用户：打开本机 Cato，进入 WorkBuddy 连接，重新生成令牌并在连接器设置中更新。不要要求用户提供令牌到对话中。
