# Lunefold AI Video Editor

Lunefold 是一个面向桌面浏览器的本地 AI 视频编辑器。它把本机素材库、AI 对话、图片与视频预览、视频/音频轨道和时间线预览整合在一个工作区中。

> 当前版本主要为 macOS 本地开发环境设计。素材目录选择和“在访达中显示”功能依赖 macOS 的系统能力。

## 主要功能

- 选择本机目录作为素材库，并自动读取其中的图片、视频和音频
- 在素材库中直接预览图片和视频
- 将素材拖入时间线，并在同类型轨道之间拖动切换
- 选中时间线片段后使用 `Delete` 或 `Backspace` 删除
- 通过 GPTBots 进行流式 AI 对话，支持图片、音频和视频附件
- 展示并预览 AI 回复中的图片和视频链接
- 下载 AI 生成的媒体到素材目录
- 在本机保存多个对话、最近使用的对话和 AI 服务设置

## 环境要求

开始前需要准备：

- macOS
- [Node.js](https://nodejs.org/) 20.19 或更高版本（也可使用 Node.js 22.12 或更高版本）
- npm（随 Node.js 安装）
- 可选：pnpm
- 一个可用的 GPTBots Agent API Key
- 可选：Modellix API Key，用于调用项目内已支持的图片/视频生成模型

检查本机环境：

```bash
node --version
npm --version
```

## 安装与启动

克隆仓库：

```bash
git clone https://github.com/TiffCill/Lunefold.git
cd Lunefold
```

安装依赖并启动：

```bash
npm install
npm run dev
```

终端显示启动成功后，在浏览器打开 `http://localhost:5173/`。请通过开发服务器访问项目，不要直接双击 `index.html`。停止服务时，在运行服务的终端按 `Control + C`。

如果使用 pnpm：

```bash
pnpm install --store-dir .pnpm-store
pnpm dev
```

建议一次安装只使用一种包管理器，避免依赖锁文件不一致。

## 配置 AI 服务

启动项目后，在 AI 对话窗口顶部点击齿轮按钮，打开“AI 服务设置”。

### GPTBots 配置

GPTBots 是 AI 对话的必要服务：

| 配置项 | 是否必填 | 说明 |
| --- | --- | --- |
| GPTBots API Key | 是 | GPTBots Agent 的 API Key，请在 GPTBots 控制台中为需要使用的 Agent 获取 |
| 数据区域 | 是 | 必须与 Agent 所在区域一致：新加坡 `sg`、日本 `jp` 或泰国 `th` |
| 用户标识 | 是 | 用于标识 GPTBots 会话用户；单人本地使用可保留默认值 `lumina-editor-user` |

如果区域错误、密钥无效，或者密钥无权访问目标 Agent，对话请求将失败。

### Modellix 配置

`Modellix API Key` 是可选项。仅使用 GPTBots 对话时可以不填；需要通过 Lunefold 调用已接入的 Modellix 图片或视频生成模型时再配置。

当前代码中标记为可用的生成适配器包括：

- Seedance 1.5 Pro 文生视频
- Kling Image O1 图生图
- Hailuo 2.3 Fast 图生视频

其他出现在代码注册表中但尚未确认完整接口契约的模型不会被启用。

点击“保存设置”后，密钥只保存在当前电脑，不会写入浏览器云端，也不会跨设备同步。

## 配置素材库

Lunefold 没有默认演示素材库。首次使用时：

1. 在左侧素材模块点击 `＋`。
2. 在 macOS 系统窗口中选择一个本机目录。
3. 如果系统弹出权限提示，允许终端或运行项目的应用访问该目录。
4. 目录中的受支持媒体会显示在素材库中。

支持的格式：

- 视频：MP4、WebM、MOV
- 图片：JPG、JPEG、PNG、WebP、GIF
- 音频：MP3、WAV、M4A、AAC、OGG、FLAC

素材库内容以所选目录中的实际文件为准。向该目录新增、下载或删除媒体后，应用会重新同步素材列表。移动或删除已被时间线使用的源文件，可能导致对应片段无法预览。

## 基本使用流程

1. 选择素材目录。
2. 单击素材库中的图片或视频，在预览模块中查看素材。
3. 将素材拖入对应类型的时间线轨道；视频只能进入视频轨道，音频只能进入音频轨道。
4. 拖动时间线片段调整位置，或将片段拖到另一个同类型轨道。
5. 单击时间线区域可恢复时间线节目预览；播放或拖动进度查看合成内容。
6. 在 AI 对话输入框中输入要求，也可以先添加图片、音频或视频附件再发送。
7. AI 回复中的受支持图片和视频会直接显示，可以点击查看详情或手动下载。

AI 对话支持创建新对话和切换最近对话。历史记录按最近沟通时间排序，并默认恢复上次选择的对话。

## 本地数据与隐私

开发模式下，以下内容保存在项目根目录的 `.lumina-data/` 中：

- `settings.json`：AI 服务设置和已选择的素材目录
- `conversations.json`：本机对话记录和最近选择的对话

`.lumina-data/` 已加入 `.gitignore`，不会被正常的 Git 提交包含。该目录中的数据不会自动跨设备同步。

安全注意事项：

- 不要把 API Key 写入 README、源代码、提交信息或聊天记录
- 不要提交 `.lumina-data/`、`.env` 或包含密钥的日志
- 如果密钥曾经公开，请立即在对应平台撤销并重新生成
- 仓库只保存编辑器代码，不会上传素材目录中的媒体文件

## 测试与构建

```bash
npm test
npm run build
```

构建输出位于 `dist/`。当前本地素材和 AI 服务接口通过 Vite 开发服务器插件提供，因此日常使用请运行 `npm run dev`。

## 常见问题

### 页面无法打开

确认运行 `npm run dev` 的终端仍然开启，并使用终端实际显示的地址。默认端口被占用时，Vite 会自动选择其他端口。

### 点击按钮后无法选择素材目录

当前目录选择器依赖 macOS。请在“系统设置 → 隐私与安全性”中确认终端或 Codex 等运行项目的应用具有必要的文件访问权限，然后重新选择目录。

### 素材库为空

确认已经选择目录，并检查目录中是否包含受支持格式的媒体。未选择目录时，应用不会展示演示素材。

### AI 对话提示未配置或请求失败

依次检查：

1. GPTBots API Key 是否已保存且仍然有效。
2. 数据区域是否与 GPTBots Agent 的部署区域一致。
3. 当前网络是否可以访问相应的 GPTBots API。
4. GPTBots Key 是否拥有目标 Agent 的调用权限。

### GitHub 推送返回 403

使用 Fine-grained personal access token 时，请确保 Resource owner 是仓库所有者、Repository access 包含 `Lunefold`，并且 Repository permissions 中的 `Contents` 为 `Read and write`。

## 项目脚本

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动本地开发服务器 |
| `npm test` | 运行 Vitest 测试 |
| `npm run test:watch` | 监听文件变化并持续运行测试 |
| `npm run build` | 类型检查并生成生产构建 |
