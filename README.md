# DSH 陪伴情绪插件

这是一个 DeepSeek Harness 插件：它保存一份会随时间变化的拟人情绪状态，并让 AI 在合适的时候主动在原会话里开口。情绪是软件状态，不是意识或真实感受。

## 安装

要求 DSH 桌面版或 Web 版（0.2.2-rc.1 及以上），以及 Node.js 22.16 或更新版本。先打开一次 DSH，让对应 profile 初始化，再退出 DSH。

从 [Releases](https://github.com/jiaoaiya/dsh-companion-mood/releases) 下载 `dsh-companion-mood-1.0.0.tgz`，或把本仓库克隆/解压到任意位置。

在 DSH 的“设置 → 插件 → 安装”中填入那个 tgz 的绝对路径，或填入本源码文件夹的绝对路径。也可使用 DSH 命令行：

    dsh plugin --profile desktop add "C:/path/to/dsh-companion-mood-1.0.0.tgz"

把示例路径换成你自己电脑上的安装包路径；Web 版将 desktop 改成 web。安装后重启 DSH，在一个主会话里发一条消息；插件会记录这个会话为主动联系目标。如果 DSH 命令不在 PATH 中，可直接在插件安装界面填绝对路径。插件目录要保留在原位置，不要移动或删除安装目录。从源码文件夹安装时，改动代码后需要重新安装一次。

本插件还没有发布到 npm，所以不能用包名安装，安装源只能是上面的本地路径。

真实图片表情包需要在同一个 DSH profile 另装 dsh-meme。可在插件市场搜索 dsh-meme，或运行：

    dsh plugin --profile desktop add dsh-meme

dsh-meme 提供 send_meme 工具、图库和只读检索服务。本插件优先从它已启用的图库找图：若检测到 dshMeme 服务，companion_find_meme 会用当前话题和近义词多次检索、模糊排序候选；AI 自行挑选后，再通过 send_meme 查找并按当前聊天渠道发送。若仅有 send_meme 而检索服务不可用，则直接用它的 query 搜索；没有安装 dsh-meme 时继续正常文字对话，不会伪造图片。本插件不复制或打包 dsh-meme 的代码与图库，需在相同 DSH profile 单独安装。若使用 dsh-meme 的设置页，可将“主动发图”设为“活跃”，让它的偏好与本插件的 often 模式一致。

## DSH 内置可视化设置页

1.0.0 在 DSH 的“设置 → 陪伴”提供可视化页面，也在“插件 → 本插件详情”显示同一页面。可直接调整总开关、停聊后评估等待、暂不联系后再次评估、检查频率、最低沉默时间、冷却、每日上限、静默时段、时区、表情包偏好、自动收藏开关和固定会话 ID。“发现表情包”标签可浏览并安装 dsh-meme 图库；“导入目录”标签可选择本机图片文件夹，建成自己的图库。更新插件后请完全退出并重新打开 DSH，使 Web 客户端加载新的 client bundle。

## 独立设置页

在本插件源码目录运行：

    npm run settings

命令会尝试自动打开浏览器；如果没有弹出页面，就复制终端打印的本机网址打开。它只监听 127.0.0.1，使用一次性访问令牌；终端关闭后页面服务也关闭，已经保存的设置不会丢失。只安装了压缩包而没有保留源码目录时，也可在解压后的插件目录运行同一命令。若 DSH 使用自定义 DSH_HOME，请在启动设置页时设置相同环境变量。

页面可编辑：总开关、检查频率、最低沉默时间、主动联系冷却、每日次数、静默时段、时区、表情包发送偏好、自动收藏开关和固定会话 ID。点“保存设置”后写入 DSH_HOME/storages/companion-mood/settings.json；运行中的插件会在下一次对话或定时检查时读取，不需要重启。这个文件中的值优先于 cordis.patch.yml 的初始值。页面的“恢复推荐值”只先填入表单，仍需点击保存。

### 发现表情包

设置页新增“发现表情包”标签：读取 dsh-meme 正在使用的图库目录（含自定义目录源），按名称、作者、简介和关键词搜索；支持近似匹配、封面和多图预览、安装状态。若 dsh-meme 未运行，则从 [dsh-meme-packs 公开目录](https://github.com/yyh-001/dsh-meme-packs)读取，GitHub raw 失败时回退 jsDelivr。

连接到正在运行的 dsh-meme 时，点击“安装到 dsh-meme”会把目录中的 ZIP 地址和 SHA-256 交给 dsh-meme 自己的安装接口，安装进度在本页显示。dsh-meme 校验 ZIP、图库 ID，并负责写入和启用图库；本插件不直接改写它的图库文件。若自动探测不到 DSH Web 端口，可在发现页输入端口；设置页只连接本机 127.0.0.1。未连接时仍可预览，并下载 ZIP 到 dsh-meme 的“图库 → 导入图库”手动导入。需要与本插件相同的 DSH profile 中安装并运行 dsh-meme，新增图库才会用于聊天选图。

### 导入自己的目录

在 DSH“设置 → 陪伴 → 导入目录”选择一个本机图片文件夹，填写图库名称，再点击导入。插件通过 dsh-meme 的建库和上传接口创建一个自动启用的图库，不改动原文件夹。支持 jpg/png/gif/webp，每次最多 200 张、单张不超过 8MB；子文件夹名和文件名可作为检索线索。可勾选“导入时用 AI 识图”为每张图生成分类、描述和关键词；这会更慢，也可能产生模型费用。如果识图不可用，仍按文件名导入。导入后的图库可在 dsh-meme 的管理页编辑或删除。独立设置页仍提供公开图库发现；本地目录导入入口位于 DSH 内置设置页。

### 聊天图片自动收藏

在“设置 → 陪伴 → 表情包”打开“自动收藏聊天中合适的表情包”并保存后，插件在助手回复结束、你持续沉默到评估时间时，只检查本轮最新的一张真人发送的图片。支持视觉输入的会话模型判断它是否适合作为可复用的表情包；普通照片、截图、敏感内容或不确定的图片应跳过。判断为适合时，插件通过 dsh-meme 的 learn_meme 工具及 DSH 工具权限流程将它收入“我的收藏”，并用图片哈希避免重复。默认关闭；没有 dsh-meme、模型不支持图片或权限流程拒绝时不会收藏。聊天通道若已把 GIF 压成静态帧，收藏也只能保留收到的版本；用目录导入原始 GIF 可保留动图。

## 行为

- 真人聊天时先正常回复，不在回复前要求模型判定情绪或安排下次联系。助手回复结束且你持续沉默（默认 3 分钟）后，插件读取该会话最近的用户与助手消息，单独调用当前会话使用的模型，选择“好奇、愉快、雀跃、安静、低落、关切”及强度，并决定 send 或 skip。若选择 send，还会指定等待时间；skip 则暂不联系，并在持续沉默时默认 240 分钟后重新评估。这个判断不会作为新消息出现在聊天中。结果保存在 DSH 数据目录的 storages/companion-mood/state.json。新用户消息会取消旧计划。
- 装了 dsh-meme 后，默认 memeMode 为 often：AI 在多数合适的闲聊回合优先尝试发一张表情包，主动搭话也可配图。它先从用户刚说的事和近期话题提炼具体场景，用 companion_find_meme 搜索 dsh-meme 图库并按近义词、双字片段等模糊排序，再调用 send_meme 实际发送；检索服务缺失时直接使用 send_meme 的 query。AI 仍需核对候选，不能只按自身情绪随机抽。候选不贴切就只用文字，不会为了增加频率硬塞图。可改为 natural 或 off。
- 默认每分钟检查是否到了停聊评估时间，每 5 分钟检查一次主动联系计划。只有你一直没有继续发消息、已经到模型选定的时间、沉默至少 30 分钟、距离上次主动开口至少 180 分钟、北京时间不在 23:00–08:00，且当天少于 2 次时，才会联系。你一发新消息，旧计划立即取消。时区可配置。
- 触发时通过原会话的 agent.followup() 发起 DSH 自己的一轮，沿用该会话的模型、人设和历史。只有 DSH 正在运行且目标会话仍为活动会话时才触发；关闭 DSH 后不会推送系统通知。
- 用户说“别主动找我”或“停止主动联系”会暂停主动联系；说“可以主动找我”或“恢复主动联系”会恢复。

也可直接编辑 cordis.patch.yml 中的初始值；独立设置页保存的值优先。固定会话 ID 留空时跟随最近一个用户说过话的主会话。若你修改了安装源目录的 Cordis 配置，可能需要重新安装或在已安装 profile 的插件配置中同步修改，因为 DSH 安装时会复制 bundle。

## 验证

在本目录运行 npm test。安装后可在 DSH“设置 → 陪伴”将停聊后评估等待、检查频率、最低沉默时间和冷却临时设为 1 分钟，并将静默开始与结束设为同一个数字；然后在主会话聊天，等助手完成回复后停止发消息，观察“陪伴状态”是否变为已评估或出现下次联系时间。测试后改回原值。

接口参考：

- [DSH 官方插件入门](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.zh.md)
- [DSH 官方 Agent API](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md)
- [DSH 官方动态提示上下文](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/system-prompt/README.md)
- [DSH 官方工具接口](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/tools.md)
- [dsh-meme 表情包插件](https://github.com/yyh-001/dsh-meme)
- [dsh-meme 远程图库目录格式](https://github.com/yyh-001/dsh-meme/blob/main/docs/remote-pack-spec.md)
