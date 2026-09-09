# 圣经 · 智慧视角（Bible Perspective）

一个把《圣经》蒸馏成 **Skill + Agent** 的开源项目：用圣经的叙事框架、主题智慧与人物叙事，回应人生困惑。

> ⚠️ **立场声明**：仅供参考，**不支持封建迷信**，不替代医疗/心理/法律等专业帮助，尊重一切信仰立场。

## 内容结构

```
E:\Bible\
├── SKILL.md                  # 主 Skill：蒸馏成果的协议化（工作流/主题速查/红线/Fallback/快速自检）
├── agents/
│   └── bible-guide.md        # Agent 定义：以圣经视角回应的顾问
├── references/               # 蒸馏知识库（6 份）
│   ├── 01-四幕叙事框架.md     # 创造→堕落→救赎→新造 的大叙事
│   ├── 02-主题智慧库.md       # 14 个主题 ×（经文/要义/应用/注意）+ 快速索引
│   ├── 03-人物叙事模式.md     # 约瑟/约伯/大卫/彼得/浪子等 9 组人物模式
│   ├── 04-表达与文体风格.md   # 八种文体规则 + 四种回应语气 + 禁语
│   ├── 05-应用守则与边界.md   # 安全红线 + 危机识别与转介
│   └── 06-保真度与自检.md     # 出厂质检评分卡 + 日常快速自检（防跑偏）
└── data/                     # 经文数据与工具
    ├── bible_cuv.json        # 和合本（神版）66 卷 31,103 节
    ├── versions/             # 多译本（归一化，按书卷编号 1-66 对齐）
    │   ├── cuv.json          # 和合本（中文）
    │   ├── kjv.json          # King James Version（英文）
    │   ├── wlc.json          # Westminster Leningrad Codex（希伯来文原文·旧约 39 卷）
    │   └── tr.json           # Textus Receptus（希腊文原文·新约 27 卷）
    ├── build-versions.js     # 多译本构建脚本：归一化各来源 → versions/
    ├── verify-versions.js    # 多译本自检：校验完整性/编号对齐/抽查经文
    ├── 查经.js               # 多译本查经工具（见下）
    └── 关键经文清单.txt       # 蒸馏时抽取的 56 节关键经文
```

## 安装（让 Claude Code 认识它）

```bash
# 1. 安装 Skill（拷到用户级 skills 目录）
mkdir -p ~/.claude/skills/bible-perspective
cp -r E:/Bible/SKILL.md E:/Bible/references E:/Bible/data ~/.claude/skills/bible-perspective/

# 2. 安装 Agent（拷到用户级 agents 目录）
mkdir -p ~/.claude/agents
cp E:/Bible/agents/bible-guide.md ~/.claude/agents/

# 3. 重启 Claude Code 会话，生效
```

> 也可以只装其中一个：只用 Skill 就用第一条命令；只用 Agent 就用第二条（Agent 内嵌了全部守则并会调用查经工具）。

## 使用方法

**方式一 · 直接用 Skill**：在对话里说「用圣经视角看看这件事」「圣经怎么说 xxx」。

**方式二 · 用 Agent**：在对话里说「让 bible-guide 从圣经角度分析一下 xxx」。

**方式三 · 只查经文**（不启动任何 Agent，支持多译本）：
```bash
node E:/Bible/data/查经.js 诗篇 23:1-6      # 按卷章查（默认和合本）
node E:/Bible/data/查经.js --搜索 饶恕      # 关键词搜索
node E:/Bible/data/查经.js --书卷           # 列出 66 卷

node E:/Bible/data/查经.js 诗篇 23:1 --kjv   # 指定译本：英文 KJV
node E:/Bible/data/查经.js 创世记 1:1 --wlc  # 希伯来文原文（旧约）
node E:/Bible/data/查经.js 约翰福音 3:16 --tr # 希腊文原文（新约）
node E:/Bible/data/查经.js 诗篇 23:1 --对照   # 全部译本平行对照
node E:/Bible/data/查经.js --译本            # 列出可用译本
```

> 多译本数据由 `node data/build-versions.js <源目录>` 构建；源文件可从
> [scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases) 下载。

## 🌐 网页聊天版（Web Chat）

一个「神性」风格的网页聊天界面，由 DeepSeek API 驱动，密钥只在服务端，支持流式回复与实时查经。

**v3 特性**
- 📖 **多译本**：和合本 / 英文 KJV / 希伯来文原文（旧约）/ 希腊文原文（新约），全局切换 + 平行对照
- ✨ **自动查经**：助手通过函数调用自动检索圣经原文，引用零编造；问原文时自动调希伯来/希腊版本
- 🔎 **书卷浏览**：侧栏按书卷逐章翻阅，随手收藏、点发
- 🔖 **收藏与复制**：经文收藏持久化（本地），一键复制
- 💾 **对话留存**：刷新不丢对话（本地），可一键清空
- ⏹ **可中断**：生成中可随时停止，保留已生成内容
- 🌙 **日 / 夜双主题**：破晓晨光 × 夜间静谧，跟随系统偏好
- 🛡 **危机检测**：检测自杀/自伤/家暴等信号，强制插入心理援助热线（400-161-9995）
- 🔐 **访问码**：设置 `ACCESS_CODE` 后需输入访问码才能对话，防陌生人白嫖
- 🔄 **不崩部署**：未配置 API Key 服务照跑，页面友好提示

```
web/
├── server.js              # 零依赖 Node 服务器：静态托管 + 聊天代理（含函数调用）+ 查经接口
├── context/system-prompt.md  # 为聊天精简的蒸馏提示词（含 search_verse 工具说明）
├── public/                # 神性风格前端（破晓晨光 × 鎏金 × 圣光）
└── .env.example           # 密钥模板（.env 已被 gitignore，绝不提交）
```

**本地运行**
```bash
cd web
cp .env.example .env        # 填入你的 DeepSeek API Key
node server.js              # 或从仓库根目录：npm start
# 打开 http://localhost:8787
```

> 多译本数据在 `data/versions/`（服务端自动向上查找 `../data/versions`），
> 从仓库根目录 `npm start` 可确保经文数据被正确加载。

**可选环境变量**
```bash
ACCESS_CODE=你的访问码   # 设置后需访问码才能对话
RATE_PER_MIN=20          # 每 IP 每分钟限流次数（默认 20）
DEEPSEEK_MODEL=deepseek-chat
PORT=8787
```

**在线部署（任一平台）**
- **Render**（推荐，免费）：
  - 方式一（Blueprint，推荐）：Render 控制台 → New → **Blueprint** → 选本仓库，仓库内的 `render.yaml` 会自动配好（根目录=仓库根、启动命令 `node web/server.js`）
  - 方式二（手动）：新建 Web Service → 根目录留空（仓库根）→ Build Command 留空 → Start Command `npm start` → 环境变量填 `DEEPSEEK_API_KEY`
  - ⚠️ 无论哪种方式，**都要从仓库根启动**，这样服务端才能找到 `data/versions/` 经文数据（服务端也会向上逐级查找，兼容不同根目录设置）
- **Railway / Fly.io / 任意 VPS**：同上，从仓库根启动 `node web/server.js`
- ⚠️ **密钥只在服务端**：前端页面不含任何密钥；部署时用平台环境变量，别写进代码

**查经 API**（网页内置，也可直接调用）
```
GET /api/versions                    # 列出可用译本
GET /api/verse?q=诗篇 23:1-6         # 按卷章引用（默认和合本）
GET /api/verse?q=饶恕                # 关键词搜索（按相关性排序）
GET /api/verse?q=约翰福音 3:16&v=cuv,kjv,tr   # 多译本平行对照
GET /api/books?v=wlc                 # 书卷目录（原文译本只有旧约/新约）
```

> `v` 参数：`cuv` 和合本 · `kjv` 英文 KJV · `wlc` 希伯来文原文（旧约）· `tr` 希腊文原文（新约）；多个用逗号并列。

## 蒸馏方法论（本项目怎么做的）

1. **素材**：下载和合本（神版）全文 66 卷 31,103 节到本地（data/）
2. **结构**：抽出四幕叙事作为总框架；按 14 个人生主题整理「经文/要义/应用/注意」
3. **人物**：9 组代表性人物叙事作为「活的案例」
4. **表达**：归纳圣经八种文体与四种回应语气
5. **守则**：把「仅供参考 / 不搞迷信 / 不归罪苦难 / 危机转介」写成硬性红线
6. **自检**：借鉴人物 skill 的「保真度评分卡」，建一套可量化的防跑偏自检清单（references/06）

## 边界说明

- 所有经文引用可实时用 `查经.js` 验证，杜绝编造
- 苦难问题明确反对「受苦=有罪」的因果论
- 危机场景（自伤/家暴/精神症状）优先转介专业求助
- 宗派争议主题保持中立，说明多种立场

## License

MIT © 2026 zengguangsheng · 数据来源：ElijahLabs/bible（和合本神版）
