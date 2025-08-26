# DevEnv Setup
安装bun
curl -fsSL https://bun.sh/install | bash
exec $SHELL -l
bun install

安装go 官网下载
sudo rm -rf /usr/local/g
sudo tar -C /usr/local -xzf go1.25.0.linux-amd64.tar.gz

echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
source ~/.bashrc

bun dev运行项目
## 🎯 项目整体架构分析

**OpenCode** 是一个基于AI的代码开发助手工具，采用**TypeScript + Go混合架构**，具有以下核心特点：

### 📋 TypeScript实现的核心功能

#### 1. **CLI命令行工具** (`packages/opencode/`)
- **核心引擎**: 基于Bun运行时的高性能CLI应用
- **会话管理**: 完整的AI对话会话系统，支持多种AI模型
- **工具集成**: 集成多种开发工具（ripgrep、fzf、bash等）
- **文件操作**: 智能文件搜索、编辑、格式化
- **AI代理**: 多种预设AI代理模式（build、plan、switch等）
- **LSP集成**: 语言服务器协议支持
- **MCP集成**: Model Context Protocol支持
- **插件系统**: 可扩展的插件架构

#### 2. **Web应用** (`cloud/app/`, `packages/web/`)
- **React前端**: 现代化的Web界面
- **云服务集成**: 基于SST的云原生架构
- **实时通信**: SSE（Server-Sent Events）实时更新
- **认证系统**: GitHub OAuth集成

#### 3. **SDK和API** (`packages/sdk/`)
- **TypeScript SDK**: 完整的客户端SDK
- **JavaScript SDK**: 浏览器端SDK
- **API接口**: RESTful API设计

### �� Go实现的核心功能

#### 1. **TUI终端用户界面** (`packages/tui/`)
- **Bubble Tea框架**: 基于Go的TUI框架
- **实时交互**: 流畅的终端用户界面
- **状态管理**: 复杂的应用状态管理
- **主题系统**: 可定制的主题和样式
- **快捷键系统**: 丰富的键盘快捷键支持
- **会话管理**: 与TypeScript后端的无缝集成

#### 2. **Go SDK** (`packages/sdk/go/`)
- **类型安全**: 强类型的Go客户端
- **API封装**: 完整的API接口封装
- **错误处理**: 健壮的错误处理机制

### 🔄 为什么采用Go + TypeScript混合架构？

#### 1. **性能优势**
- **Go**: 用于性能关键的TUI界面，提供流畅的用户体验
- **TypeScript**: 用于复杂的业务逻辑和AI集成，开发效率高

#### 2. **生态系统优势**
- **Go**: 优秀的TUI生态系统（Bubble Tea、Lip Gloss等）
- **TypeScript**: 丰富的Web开发和AI集成生态

#### 3. **开发效率**
- **Go**: 编译型语言，运行时性能优秀
- **TypeScript**: 类型安全，开发体验好，生态丰富

#### 4. **架构分离**
- **前端界面**: Go负责TUI，TypeScript负责Web
- **后端服务**: TypeScript负责核心逻辑和AI集成
- **SDK**: 两种语言都提供完整的SDK

### 🏗️ 核心架构特点

#### 1. **微服务架构**
- 清晰的模块分离
- 独立的包管理
- 松耦合的设计

#### 2. **AI驱动**
- 多模型支持（Anthropic、OpenAI、Gemini等）
- 智能代理系统
- 上下文感知

#### 3. **开发者友好**
- 多种界面选择（CLI、TUI、Web）
- 丰富的工具集成
- 可扩展的插件系统

#### 4. **云原生**
- 基于SST的云部署
- 实时通信支持
- 可扩展的架构

这种混合架构充分利用了两种语言的优势，为开发者提供了一个功能强大、性能优秀的AI编程助手工具。


# agent的定义和创建
.opencode/agent/下面的md文件也可以定义agent，比如docs和git-committer agent的名字和md文件名字保持一致


## `Agent.list()`获取的内容详解

### 1. **state()函数的作用**
```typescript
const state = App.state("agent", async () => {
  // 这个函数会返回一个包含所有agent配置的对象
  // 只在第一次调用时执行，后续调用会缓存结果
})
```

### 2. **获取的内容包括**

#### **A. 内置Agent (硬编码)**
```typescript
const result: Record<string, Info> = {
  general: {
    name: "general",
    description: "General-purpose agent for researching complex questions...",
    tools: { todoread: false, todowrite: false, ...defaultTools },
    options: {},
    permission: agentPermission,
    mode: "subagent",
    builtIn: true,
  },
  build: {
    name: "build",
    tools: { ...defaultTools },
    options: {},
    permission: agentPermission,
    mode: "primary",  // 这是TUI中可切换的agent
    builtIn: true,
  },
  plan: {
    name: "plan",
    options: {},
    permission: planPermission,
    tools: { ...defaultTools },
    mode: "primary",  // 这是TUI中可切换的agent
    builtIn: true,
  },
}
```

#### **B. 配置文件中的Agent**
```typescript
// 从cfg.agent中加载配置的agent
for (const [key, value] of Object.entries(cfg.agent ?? {})) {
  if (value.disable) {
    delete result[key]  // 如果被禁用则删除
    continue
  }
  // 合并配置到result中
}
```

#### **C. Markdown文件中的Agent**
这些agent是通过`Config.get()`加载的，包括：
- **项目级agent**: `.opencode/agent/*.md` (如docs.md, git-committer.md)
- **全局agent**: `~/.config/opencode/agent/*.md`

### 3. **每个Agent包含的信息**
```typescript
export const Info = z.object({
  name: z.string(),                    // agent名称
  description: z.string().optional(),  // 描述
  mode: z.union([                      // 模式
    z.literal("subagent"),             // 子agent，TUI中不可切换
    z.literal("primary"),              // 主agent，TUI中可切换
    z.literal("all")                   // 所有模式
  ]),
  builtIn: z.boolean(),                // 是否内置
  topP: z.number().optional(),         // 模型参数
  temperature: z.number().optional(),  // 模型参数
  permission: z.object({               // 权限配置
    edit: Config.Permission,
    bash: z.record(z.string(), Config.Permission),
    webfetch: Config.Permission.optional(),
  }),
  model: z.object({                    // 模型配置
    modelID: z.string(),
    providerID: z.string(),
  }).optional(),
  prompt: z.string().optional(),       // 系统提示词
  tools: z.record(z.boolean()),        // 可用工具
  options: z.record(z.string(), z.any()), // 其他选项
})
```

### 4. **最终返回的内容**
```typescript
export async function list() {
  return state().then((x) => Object.values(x))  // 返回所有agent的数组
}
```

## 总结

`Agent.list()`获取了**所有可用的agent配置**，包括：

1. **内置agent**: general, build, plan
2. **项目级agent**: docs, git-committer (来自`.opencode/agent/`)
3. **全局agent**: 来自`~/.config/opencode/agent/`
4. **配置文件agent**: 来自`opencode.json`等配置文件

每个agent都包含完整的配置信息，包括名称、描述、模式、权限、工具、模型等。这些信息会被传递给Go TUI，用于显示和切换agent。