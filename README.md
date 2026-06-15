# Hitokoto Server

一键部署的自托管「一言」服务。收集、管理、分享短句与语录，支持列表汇聚、API 调用和完整的后台管理。

> 灵感来自 [hitokoto.cn](https://hitokoto.cn)，完全自托管，数据主权在你手中。

---

## 特性

### 📝 语录管理
- 创建、编辑、删除语录，支持分类标签（动画、漫画、小说等 12 个默认分类）
- 审核工作流：用户提交 → 审核员审批 → 公开可见
- 随机语录 API，支持分类过滤、关键词搜索、匿名去重（Token 机制）

### 📂 列表系统
- **普通列表** — 手动精选语录集合，支持自定义排序
- **汇聚列表** — 引用其他列表的内容，递归展开汇聚所有子列表的语录
- **层级结构** — 引用的汇聚列表以文件夹树形式展示
- **公开/私有** — 私有列表需 API Key 访问，公开列表可被所有人引用
- **去重** — 汇聚列表自动按语录去重（SQL + 代码双重保证）

### 🔐 用户与权限
- JWT 双 Token 认证（Access 15min + Refresh 7天）
- 邀请码注册机制
- 角色系统：普通用户 / 审核员 / 管理员
- 细粒度权限位（审核、分类管理、删除、上传）

### 🌐 API 优先
- 完整的 RESTful API
- 公开列表浏览接口
- 随机语录支持列表维度（按 UUID + API Key 访问私有列表）
- 内置 API 文档页面 (`/docs`)

### 🎨 前端
- React 19 + TypeScript + Ant Design 6
- 响应式设计（桌面/移动端）
- 深色主题支持
- 管理面板（用户管理、分类管理、系统设置、邀请码管理）

---

## 快速开始

### 使用预编译二进制

从 [Releases](https://github.com/tomk1998/hitokoto-server/releases) 下载对应平台的最新版本。

```bash
# 解压后直接运行
./hitokoto-server
# 访问 http://localhost:7070 进入安装向导
```

### 从源码构建

```bash
# 1. 克隆
git clone https://github.com/tomk1998/hitokoto-server.git
cd hitokoto-server

# 2. 安装前端依赖
cd frontend && pnpm install && cd ..

# 3. 构建（前端 → dist/，然后编译 Go 二进制）
pnpm build

# 4. 运行
./dist/server
```

### 开发模式

```bash
# 一键启动前后端开发服务器（前端 Vite 热重载 + 后端 Air 热重载）
pnpm dev

# 或分别启动：
pnpm dev:backend   # Air 热重载，端口 7070
pnpm dev:frontend  # Vite，端口 5173，代理 /api 到 7070
```

---

## 配置

通过 `.env` 文件或环境变量配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DB_DRIVER` | `sqlite` | 数据库驱动：`sqlite` 或 `mysql` |
| `DB_HOST` | `localhost` | MySQL 主机 |
| `DB_PORT` | `3306` | MySQL 端口 |
| `DB_USER` | `root` | MySQL 用户 |
| `DB_PASSWORD` | 空 | MySQL 密码 |
| `DB_NAME` | `hitokoto` | MySQL 数据库名 |
| `DB_PATH` | `hitokoto.db` | SQLite 文件路径 |
| `JWT_SECRET` | `hitokoto-access-secret-key` | JWT Access Token 密钥 |
| `JWT_REFRESH_SECRET` | `hitokoto-refresh-secret-key` | JWT Refresh Token 密钥 |
| `SERVER_PORT` | `7070` | HTTP 服务端口 |

首次运行会自动创建 `hitokoto.db`（SQLite 模式），访问页面后会进入安装向导创建管理员账号。

---

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Go 1.25, Gin, GORM, JWT, bcrypt |
| 数据库 | SQLite（默认）或 MySQL |
| 前端 | React 19, TypeScript, Ant Design 6, Vite |
| 包管理 | pnpm（前端） |
| 图表 | ECharts, Recharts |

---

## 项目结构

```
hitokoto-server/
├── main.go                    # 入口：配置、数据库、路由、静态文件
├── backend/
│   ├── config/                # 配置加载
│   ├── database/              # 数据库连接、迁移、重置
│   ├── model/                 # GORM 模型定义
│   ├── handler/               # HTTP 处理器
│   ├── repository/            # 数据库操作层
│   ├── middleware/            # Gin 中间件（JWT、API Key、限流）
│   ├── router/                # 路由注册
│   ├── permissions/           # 权限位定义
│   ├── setup/                 # 安装流程
│   └── utils/                 # 工具函数（API Key 生成/哈希）
├── frontend/                  # React SPA
│   └── src/
│       ├── pages/             # 页面组件
│       ├── components/        # 通用组件
│       ├── contexts/          # React Context（Auth、SiteConfig）
│       ├── hooks/             # 自定义 Hooks
│       └── utils/             # 工具函数（API 客户端）
├── dist/                      # 构建产物
├── .env                       # 环境配置
├── .air.toml                  # Air 热重载配置
└── .github/workflows/ci.yml   # CI 流水线
```

---

## API 概览

### 公开接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/quotes` | 分页浏览语录 |
| GET | `/api/quotes/random` | 随机语录 |
| GET | `/api/quotes/:id` | 语录详情 |
| GET | `/api/categories` | 分类列表 |
| GET | `/api/leaderboard` | 排行榜 |
| GET | `/api/public/lists` | 浏览公开列表 |
| GET | `/api/public/lists/:uuid` | 查看单个列表（公开/私有） |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/register` | 注册（需邀请码） |

### 认证接口（需 Bearer Token）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/lists` | 创建列表 |
| GET | `/api/lists` | 我的列表 |
| POST | `/api/lists/:id/references` | 添加引用（汇聚列表） |
| POST | `/api/lists/:id/items` | 添加语录到列表 |
| POST | `/api/quotes` | 创建语录 |

完整接口文档见 `/docs` 页面或 `backend/router/router.go`。

---

## 列表汇聚功能

汇聚列表（Aggregated List）是系统的核心特色功能：

```
我的汇聚列表
├── 动画台词（普通列表，12 条）
├── 经典文学（普通列表，8 条）
└── 朋友分享（汇聚列表）
    └── 他的收藏（普通列表，5 条）
```

- 汇聚列表 **不直接存储语录**，而是通过引用关系动态聚合
- 支持递归嵌套（最多 5 层）
- 自动去重：同一语录出现在多个来源列表中只显示一次
- 公开列表可被跨用户引用
- 循环引用不会报错（系统在读取时通过 visited 集保护）

---

## 构建部署

```bash
# 完整构建
pnpm build
# 产物：dist/server（单文件二进制，含前端静态资源）

# 跨平台构建
GOOS=linux GOARCH=amd64 go build -o dist/hitokoto-server-linux-amd64 .
GOOS=windows GOARCH=amd64 go build -o dist/hitokoto-server-windows-amd64.exe .
GOOS=darwin GOARCH=amd64 go build -o dist/hitokoto-server-darwin-amd64 .
```

---

## 许可

MIT License © 2026 TomKe
