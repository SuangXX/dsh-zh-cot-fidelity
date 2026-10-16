# dsh-zh-cot-fidelity

给 DeepSeek Harness 用的**全局系统提示词插件**。装一次，所有会话、所有 agent preset、
所有子 agent 都吃这套规则。

三组规则，每组都能单独关：

| 组 | 内容 | 开关 |
|---|---|---|
| 中文思维链 | 内部推理（reasoning / thinking）一律用中文；代码、命令、术语、引用保持原样；最终回复跟随用户语言 | `thinkingChinese` |
| 内容保真 | 原文的脏话、粗口、NSFW、血腥暴力、黑暗题材照实翻译；不净化、不打码、不省略、不加道德评判与免责声明、不用委婉语替换原词 | `contentFidelity` |
| 反八股 | 套路比喻与腻词、类比说理、机械感与报告腔、霸总腔、讨好附和、叙事降智、复读与多版本输出 | `antiCliche` `antiMechanical` `antiBoss` `antiFlattery` `narrativeIntegrity` `antiRepetition` |

规则文本在 [`prompt.js`](./prompt.js)，措辞想改就直接改那里。

## 安装

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-zh-cot-fidelity
```

装完重启一次 DSH Web（桌面应用里则是重新加载插件），提示词即对所有会话生效。

要求：DSH `>=0.2.0-rc.2 <0.3.0-0`，Node `>=22`。本插件只往系统提示词注册一个
section —— 不注册工具、不发网络请求、不读写任何文件。

## 目录

```
.
├── index.js          插件入口：拼装文本 + 注册提示词 section
├── prompt.js         全部规则文本
├── cordis.patch.yml  行声明与默认 config
├── locale/           插件管理页显示用的标题与描述
└── package.json      清单：dsh.bundle.patch 指向 cordis.patch.yml
```

## 改规则 / 换开关

1. 改 `prompt.js`（措辞）或 `cordis.patch.yml` 的 `config:`（开关）；
2. 重新安装该插件或重启 DSH，让插件重新加载。

### 本机（DSHA 手机容器）开发

源码放在 `/sdcard/dsh/plugins/dsh-zh-cot-fidelity/`。`/sdcard` 是 FUSE 挂载、
**不支持符号链接**，profile 没法直接 `link:` 到这里，所以用 `deploy.sh` 复制到
`/root/dsh-zh-cot-fidelity/`，并补上依赖解析用的 `node_modules` 符号链接：

```sh
sh /sdcard/dsh/plugins/dsh-zh-cot-fidelity/deploy.sh
```

然后重启 DSH Web（手机 App 里重新打开）。

## 配置项

```yaml
config:
  thinkingChinese: true      # 内部推理用中文
  contentFidelity: true      # 脏话 / NSFW / 暴力内容照实处理，不净化
  antiCliche: true           # 套路比喻、腻词、类比说理
  antiMechanical: true       # 机械感、报告腔、无谓量化
  antiBoss: true             # 霸总腔、权力角色浮夸台词
  antiFlattery: true         # 附和、讨好、零信息量恭维
  narrativeIntegrity: true   # 叙事：用户输入是尝试而非事实，NPC 不降智
  antiRepetition: true       # 复读、多版本输出、推倒重写
  selfCheck: true            # 末尾附加产出前自检清单
  order: 10150               # 系统提示词里的排序位置，越大越靠后
  extra: ''                  # 你自己的附加规则，追加在末尾
```

## 代价

这段提示词每一轮请求都会随系统提示词发送，约 3000 字符（≈2000+ token）。
不想要的组关掉即可；全关光就不会注册任何 section。

## 边界

内容保真只影响**文本内容的忠实度**：它不改变工具权限、审批策略、设备操作规则，
也不是“绕过任何安全机制”的开关。
