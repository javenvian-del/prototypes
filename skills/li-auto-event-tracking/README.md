# 理想汽车埋点批量创建

从飞书表格逐行读取基础信息，由本机脚本在用户增长运营平台创建事件，回写I列事件名称和J列事件标识。模型只处理范围确认、异常和完成通知；正常运行不逐行监督或读取日志。

## 一条命令安装

macOS / Linux（需 Node.js 20+、Git、curl、npm和已安装的Google Chrome）：

```bash
curl -fsSL https://raw.githubusercontent.com/javenvian-del/prototypes/main/skills/li-auto-event-tracking/install.sh | bash
```

默认同时安装到 Codex 的 `~/.codex/skills/li-auto-event-tracking`（尊重CODEX_HOME）和 Claude Code 的 `~/.claude/skills/li-auto-event-tracking`。重新开启对话后，用中文名称调用；Claude Code也可用 `/li-auto-event-tracking`。技能标识使用英文是为了兼容客户端，显示名称为「理想汽车埋点批量创建」。

只装某一端：在命令末尾把 `bash` 换成 `bash -s -- --target codex` 或 `bash -s -- --target claude`。安装更新会备份原技能目录，不删除运行数据。Windows建议在能启动Chrome并访问公司内网的Linux桌面环境执行；本包未在Windows验证。

## 模板

[直接下载空白Excel模板](https://github.com/javenvian-del/prototypes/raw/refs/heads/main/templates/event-tracking-template.xlsx)。导入飞书，保留Sheet1及A–J列标题；H列插入单元格图片。I/J留空等待脚本回写。

## 首次运行

把下列技能路径换成实际安装路径。无需把飞书链接、登录凭据上传给GitHub。

```bash
node ~/.codex/skills/li-auto-event-tracking/scripts/control.mjs init --sheet-url '你的飞书表格链接' --platform-url '运营平台事件管理页链接'
node ~/.codex/skills/li-auto-event-tracking/scripts/control.mjs check-login
node ~/.codex/skills/li-auto-event-tracking/scripts/control.mjs login
```

登录失败时才需第三条命令：在弹出的专用Chrome中登录飞书和运营平台，终端按回车。两端检查都通过后，先确定本次行范围，再执行：

```bash
node ~/.codex/skills/li-auto-event-tracking/scripts/control.mjs run --rows 6-18 --confirmed
```

`--exclude 10-12` 可排除暂缓行。没有明确行范围脚本拒绝执行。只填写基础信息，不填写自定义参数。I或J已有值以及平台已有事件都会跳过；有明确本地提交记录的中断回写只补写，不重建。元素名称特殊字符自动去掉，源表格不改，空名或超长停止。

配置、执行日志及登录会话保存在 `~/Documents/Codex/li-auto-event-tracking-data`，可通过 `LI_AUTO_TRACKING_DATA` 改位置。每次运行只输出异常或完成摘要，详细日志留在本地。不调用任何模型API；代理处理请求和异常仍会消耗token，不能承诺零token。

## ChatGPT

普通ChatGPT对话没有本机终端或内网浏览器执行能力，不能用这条命令把它变成可执行的本机skill。可以把本技能说明和模板作为项目资料，用ChatGPT协助填写和解释，再在本机终端运行相同脚本。若使用的代理环境明确提供本机终端，才可让它依照SKILL.md执行；云端Python环境不能替代公司内网和本机登录。

仓库只包含代码和空白模板，不携带会话、真实截图、实际事件或私有表格链接。已在macOS的现有流程验证；Claude Code入口沿用通用技能格式，未替你启动Claude Code进行生产创建测试。
