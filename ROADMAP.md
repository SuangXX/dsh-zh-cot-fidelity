# 更新计划

## 待做

### 1. 提示词文本的图形编辑入口（侧边栏面板 / 小窗口）

**目标**：在 Web GUI 里直接编辑规则文本，不用手动改文件。保存即生效 —— 规则文本的热更新已经实测过（每次组装系统提示时重读文件，带 mtime 缓存）。

**形态**：两种都可以，插入点都是当前运行时里已存在的 slot。

| 形态 | 插入点 | 特点 |
|---|---|---|
| **小窗口 / 浮层** | `shell.overlay` —— *Frame-wide floating layer, above every column and outside their scroll containers* | 触发后浮在界面上，随时开关；实现最简单，不占版面 |
| **侧边栏面板** | `sidebar.panellist`（全局面板图标）或 `sidebar.right.pane.tab.*`（右侧栏 tab，dsh-purge 的 dock 就是这一类） | 常驻、与其它面板并列 |

触发按钮可以放在 `sidebar.footer.action`（侧边栏底部、Settings 旁边）。另有一个更靠边的落点：`plugins.row.config` —— 插件管理页里给这一行加一个"配置"入口。

**技术路径**

- **宿主半**：`ctx.inject(['webServer'], (host) => host.webServer.register({ path, handler }))`
  - `GET`：列出 `rules/*.md`、各入口的 order / enabled / 字符数、当前 profile 配置
  - `POST`：保存单档文本（**原子写**：临时文件 + `rename`）、新建 / 删除档
  - **路径白名单**：只允许 `$DSH_HOME/zh-cot-fidelity/rules/` 下的 `.md`，不接受任意路径
- **客户端半**：`client.js` + `package.json` 的 `dsh.client`
  - `{ "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-slots", ...] }`
  - 用 `window.__ModuleLoader__.load({ id, factory })` 的形态打包
  - 本机已有两个可照抄的实例：`/root/dsha-app-integration`、`/root/dsha-web-mobile`
- **复用现有逻辑**：面板与 `/zhcot` 命令、`zhcot_status` 工具共用同一批读写函数，不另起一套

**分期**

1. **只读**：列出各档、显示字符数与位置、点开看内容（零风险，先验证 slot 与路由通不通）
2. **编辑单档**：改文本 + 保存（保存前把原文件备份为 `.bak`）
3. **档管理**：新建 / 重命名 / 删除 / 切换
4. **入口管理**：改 `order` / `enabled`，写 profile 的 `cordis.patch.yml` —— 配置热重载已实测可行，但必须用文本插入而不是"解析后整份重写"，否则会丢掉注释与其它条目

**风险与前置**

- 客户端插件有构建产物；本机的 client-plugin HMR 只在 `pnpm run dev:web` 同时运行时才自动重载，否则要刷新页面
- slot 名随 DSH 版本可能变 —— 实现时用 `cordis_inspect_query`(client / Slots) 重新核对，不要硬编码
- 写文件接口必须限定路径白名单，且不提供"任意路径写入"
- 第 4 期会改 profile 配置，风险最高，放在最后

**已完成的前置**

- 规则文本热更新 ✓（实测：改 `rules/*.md` 下一轮生效）
- profile 配置热重载 ✓（实测：新增一个 inline 入口，未重启即出现在下一轮系统提示里）
- 命令面 `zhcot_status` 工具 ✓

---

## 已完成

- 1.0.0：9 组规则、单 section
- 1.1.0：入口表（位置 / 来源 / 开关 / 合并方式）、场景档与题材档、只读审计、契约自检、`/zhcot` 命令、去重
- 1.2.0：五份出厂规则档纳入包内（首次运行释放，已存在的不覆盖）；修掉一批文档与代码互相矛盾的地方
  —— 契约自检里的恒真项、`order` 缺省的说明、生效条件（改配置其实不用重启）、
  头部标题挂错入口、规则组定义顺序、审批策略的判定方式
- 1.3.0：新增「亲密描写（成人向 · 风格档）」`rules/style-nsfw.md`，取代原「成人向创作模式」。
  改用目标法（越黄越好、必须直白）替代原来的词汇排他清单，删掉「不用医学词」「不用网络黑话」
  两条互相打架的排除项；前提设定（成年角色、未成年绝对禁止）随之迁入新档，不随旧档禁用而丢失。
  profile 里 `style-intimate` 入口保留但关闭，可随时切回
- 1.4.0：`style-nsfw.md` 增加「执行流程」七层 —— 设定层（判定完即关闭，不污染后续层）→
  词表层（动笔前固定，后续只从表内取词）→ 叙事层／对白层（分开写，对白的口语化不许回流叙事）
  → 保真转写（草稿转正文逐句对照）→ 复审（正查准确词在场／反查替代词清场／高潮段倒序查）
  → 放行。目标是压住写作瞬间的词汇滑移，而不只是靠规范文本给方向
