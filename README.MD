# GoSuxin V1.0.0

GoSuxin 是由 Suxin 技术团队维护的 Go 开发框架与管理后台，包含本地基础框架、Suxin CLI、数据库驱动、Vue 3 管理界面、内置 AI/MCP 和独立运行插件机制。

## 当前功能

- Go 后端与本地 `framework` 模块，支持同工作区开发框架、CLI 和数据库驱动。
- Vue 3 + TypeScript + Vite 管理后台，采用 Arco Design，支持多种导航布局及页签样式。
- 登录、角色权限、用户组织、菜单、系统配置、字典、附件和操作日志。
- 登录令牌与接口校验，操作日志中的凭据脱敏。
- 内置 AI 模型配置、模型调用、开发令牌管理、接口目录和 MCP 接入。
- 预编译插件 ZIP 的安装、更新、卸载、重新安装，以及插件进程、菜单和访问权限管理。

当前工程提供主程序和通用插件 SDK；业务功能通过独立运行插件扩展。协议和开发入口见 [运行插件指南](docs/runtime-plugins.md)。

## 环境要求

| 环境 | 版本或用途 |
| --- | --- |
| Go | 1.25.1 或兼容工具链 |
| MySQL | 8，保存系统及业务数据 |
| Node.js | 24.14.x |
| npm | 11.9.x，使用已提交的锁文件安装依赖 |
| Python | 3，初始化本地配置及同步前端资源 |
| Redis | 按实际使用的缓存功能配置，连接模板位于后端配置中 |

应用、框架和 CLI 的模块版本为 `v1.0.0`。根目录 `go.work` 用于本地多模块开发。

## 安装与启动

以下命令均从项目根目录执行。首次使用先初始化配置：

```shell
python scripts/init-local-config.py
```

脚本创建缺失的配置文件并生成鉴权密钥，已有文件保持原值。填写 `manifest/config/config.yaml` 的数据库连接；应用设置和上传设置分别位于 `manifest/config/app.yaml`、`manifest/config/upload.yaml`。

配置模板的默认数据库名为 `gosuxin_v1_0`，表前缀为 `gf_`，HTTP 端口为 `8603`。本机当前实例使用数据库 `GoxinV1`；其他环境以自己的实际配置为准。数据库密码和令牌不写入文档。

```shell
go run .
```

首次安装在模板默认的 `debug` 模式下访问 `http://127.0.0.1:8603/install/`，按页面流程设置数据库和管理员账号，完成后重新启动服务。安装器适用于新数据库；已有部署保留配置、数据库及安装锁。

后台地址为 `http://127.0.0.1:8603/suxinweb/`。管理员账号由安装流程设置，没有通用默认密码。

Windows 本地后台启动也可使用以下方式，需先构建 `bin/gosuxin.exe`：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1
```

该脚本使用端口 `8603`，检测已有实例并补齐上传目录。PID 保存在 `runtime/core-host.pid`，标准输出和错误日志分别位于 `runtime/core-running-stdout.log`、`runtime/core-running-stderr.log`；应用日志按后端配置写入 `runtime/log/`。

## 开发与构建

Windows 后端构建：

```shell
go build -mod=readonly -trimpath -o bin/gosuxin.exe .
```

Linux 后端构建：

```shell
go build -mod=readonly -trimpath -o bin/gosuxin .
```

构建到现有程序路径前，应先退出使用该文件的服务。运行已构建程序时使用项目根目录作为工作目录，以便读取配置和资源。

前端检查与生产构建：

```shell
cd web
npm ci
npm run check
cd ..
python scripts/sync-frontend.py
python scripts/repack_webcode.py
```

`npm run check` 执行类型检查、布局与前端行为测试及生产构建。构建输出为 `web/dist/`，同步后部署在 `resource/suxinweb/`；源码安装器的前端包为 `devsource/developer/install/webcode.zip`。前端开发服务、接口地址和部署方式见 [前端说明](web/README.md)。

主程序和共享插件框架的检查命令与 CI 一致：

```shell
go test ./internal/builtinai ./internal/devtools/ai ./internal/devtools/access ./internal/logic/admin_system ./internal/runtimeplugin ./utility/auth
```

## AI 与插件

AI/MCP 通过后台“开发者工具”进入，模型地址、模型名称、密钥和开发令牌在该页面配置。管理接口位于 `/admin/developer/ai/`，接口目录为 `GET /admin/developer/ai/interfaces`，MCP 入口为 `/mcp`。管理功能仅对启用的超级管理员开放，MCP 使用单独创建的 Bearer 开发令牌。

运行插件通过“插件市场”上传与服务器操作系统和 CPU 架构匹配的 `suxin-runtime-v1` ZIP。后续安装和更新使用预编译程序，服务器无需 Go 或 npm；卸载关闭插件接口和进程，并保留插件数据与角色授权。依赖插件的 MCP 工具需要对应插件处于已安装状态。

插件管理页面位于 `/plugins/<name>/admin/`，在宿主后台通过 `/suxinweb/runtime-plugins/<name>` 进入；普通角色需由管理员授予插件访问权限。

## 目录结构

| 路径 | 内容 |
| --- | --- |
| `api/` | 接口请求与响应定义 |
| `internal/` | 控制器、业务逻辑、数据访问、权限及主程序服务 |
| `framework/` | 本地框架、CLI 与驱动模块 |
| `web/` | 管理后台源码与前端测试 |
| `manifest/` | 配置模板、SQL 和部署资源 |
| `devsource/developer/install/` | 安装页面、初始化 SQL 和前端源码包 |
| `resource/` | 已部署的后台静态文件、公共资源及上传目录 |
| `scripts/` | 配置初始化、资源同步、安装及维护脚本 |
| `storage/` | 系统私有配置与插件持久化数据 |
| `runtime/` | 日志、PID 和本地临时文件 |
| `docs/` | 运行插件使用与开发说明 |

`scripts/clean-obsolete.ps1` 默认只预览已确认的一次性历史文件；添加 `-Apply` 才执行清理。清理范围采用明确的文件白名单，正在占用的文件会跳过。

## 许可证

项目采用 [MIT 许可证](LICENSE)。框架及各子模块的原有许可证和源码声明保留在对应目录中。
