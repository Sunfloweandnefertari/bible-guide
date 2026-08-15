# 圣经 · 智慧视角（Bible Perspective）

一个把《圣经》蒸馏成 **Skill + Agent** 的开源项目：用圣经的叙事框架、主题智慧与人物叙事，回应人生困惑。

> ⚠️ **立场声明**：仅供参考，**不支持封建迷信**，不替代医疗/心理/法律等专业帮助，尊重一切信仰立场。

## 内容结构

```
E:\Bible\
├── SKILL.md                  # 主 Skill：蒸馏成果的协议化（工作流/主题速查/红线/Fallback）
├── agents/
│   └── bible-guide.md        # Agent 定义：以圣经视角回应的顾问
├── references/               # 蒸馏知识库（5 份）
│   ├── 01-四幕叙事框架.md     # 创造→堕落→救赎→新造 的大叙事
│   ├── 02-主题智慧库.md       # 14 个主题 ×（经文/要义/应用/注意）+ 快速索引
│   ├── 03-人物叙事模式.md     # 约瑟/约伯/大卫/彼得/浪子等 9 组人物模式
│   ├── 04-表达与文体风格.md   # 八种文体规则 + 四种回应语气 + 禁语
│   └── 05-应用守则与边界.md   # 安全红线 + 危机识别与转介
└── data/                     # 和合本全文（神版）
    ├── bible_cuv.json        # 66 卷 31,103 节结构化全文
    ├── 查经.js               # 查经工具：node 查经.js 诗篇 23:1-6 / --搜索 饶恕
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

**方式三 · 只查经文**（不启动任何 Agent）：
```bash
node E:/Bible/data/查经.js 诗篇 23:1-6    # 按卷章查
node E:/Bible/data/查经.js --搜索 饶恕    # 关键词搜索
node E:/Bible/data/查经.js --书卷         # 列出 66 卷
```

## 🌐 网页聊天版（Web Chat）

一个「神性」风格的网页聊天界面，由 DeepSeek API 驱动，密钥只在服务端，支持流式回复与实时查经。

```
web/
├── server.js              # 零依赖 Node 服务器：静态托管 + 聊天代理 + 查经接口
├── context/system-prompt.md  # 为聊天精简的蒸馏提示词
├── public/                # 神性风格前端（深空星夜 × 圣光 × 鎏金）
└── .env.example           # 密钥模板（.env 已被 gitignore，绝不提交）
```

**本地运行**
```bash
cd web
cp .env.example .env        # 填入你的 DeepSeek API Key
node server.js
# 打开 http://localhost:8787
```

**在线部署（任一平台）**
- **Render**（推荐，免费）：新建 Web Service → 根目录选 `web/` → Build Command 留空 → Start Command `node server.js` → 环境变量填 `DEEPSEEK_API_KEY`
- **Railway / Fly.io / 任意 VPS**：同上，把 `web/` 部署为 Node 服务
- ⚠️ **密钥只在服务端**：前端页面不含任何密钥；部署时用平台环境变量，别写进代码

**查经 API**（网页内置，也可直接调用）
```
GET /api/verse?q=诗篇 23:1-6     # 按卷章引用
GET /api/verse?q=饶恕            # 关键词搜索
```

## 蒸馏方法论（本项目怎么做的）

1. **素材**：下载和合本（神版）全文 66 卷 31,103 节到本地（data/）
2. **结构**：抽出四幕叙事作为总框架；按 14 个人生主题整理「经文/要义/应用/注意」
3. **人物**：9 组代表性人物叙事作为「活的案例」
4. **表达**：归纳圣经八种文体与四种回应语气
5. **守则**：把「仅供参考 / 不搞迷信 / 不归罪苦难 / 危机转介」写成硬性红线

## 边界说明

- 所有经文引用可实时用 `查经.js` 验证，杜绝编造
- 苦难问题明确反对「受苦=有罪」的因果论
- 危机场景（自伤/家暴/精神症状）优先转介专业求助
- 宗派争议主题保持中立，说明多种立场

## License

MIT © 2026 zengguangsheng · 数据来源：ElijahLabs/bible（和合本神版）
