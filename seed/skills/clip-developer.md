---
description: 开发和部署 Pinix Clip。当用户说「做一个 clip」「开发一个工具」「写一个服务」时使用。
---

## Pinix Clip 是什么

Clip 是 Pinix 平台的标准应用单元——自包含、可部署、通过 gRPC 暴露能力。类比 Docker 容器，但更轻量。

## 目录结构

```
my-clip/
├── clip.yaml          # 元信息（必须）
├── commands/          # 可执行命令（Pinix Invoke 入口）
│   ├── task-list      # 每个文件 = 一个命令
│   └── task-create
├── web/               # 可选：前端（index.html 为入口）
├── seed/              # 可选：初始数据（首次安装复制到 data/）
├── data/              # 运行时数据（可变，不入版本控制）
└── Makefile           # 构建脚本
```

## clip.yaml

```yaml
name: my-clip
description: "一句话描述，会被 GetInfo RPC 返回给调用方"
version: 0.1.0
hasWeb: true   # 有 web/ 目录时设为 true
```

## 命令开发

命令就是 `commands/` 下的可执行文件。Pinix 通过 `ClipService.Invoke(name, args, stdin)` 调用它们。

### Python 命令（最简单）

```python
#!/usr/bin/env python3
import sys, json, select

# 非阻塞读 stdin（关键！BoxLite VM 中 stdin pipe 不会自动关闭）
try:
    import select as sel
    raw = sys.stdin.read() if sel.select([sys.stdin], [], [], 0.1)[0] else ""
    data = json.loads(raw) if raw.strip() else {}
except:
    data = {}

# 业务逻辑
result = {"status": "ok"}
print(json.dumps(result, ensure_ascii=False))
```

**关键：stdin 必须用 `select` 非阻塞读取。** `json.load(sys.stdin)` 和 `sys.stdin.read()` 在 BoxLite VM 中会永远阻塞，因为 Pinix 打开 stdin pipe 但不发 EOF。

### Shell 脚本命令（包装二进制）

```sh
#!/bin/sh
exec "$(dirname "$0")/../bin/my-binary" subcommand "$@"
```

适用于 Go/Rust 编译型语言——二进制放 `bin/`，命令文件是薄 wrapper。

### Go 命令

用 cobra 做子命令，交叉编译为 `CGO_ENABLED=0 GOOS=linux GOARCH=arm64`。

## Web 前端

- `web/index.html` 是入口
- 通过 `pinix-web://{clip-name}/web/index.html` 加载
- 数据文件通过 `pinix-data://local/data/xxx` 访问
- JS Bridge 可用 `Bridge.invoke(command, {args, stdin})` 调用命令
- 推荐 Vite + React，`outDir: 'web'`

## 构建与部署

### Makefile 模板

```makefile
.PHONY: build ui deploy package clean

# Go 二进制（如果有）
build:
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o bin/my-binary ./cmd/...

# 前端（如果有）
ui:
	cd frontend && pnpm build

# Dev 模式（Pinix 直接读 workdir）
deploy: build ui
	@echo "Done."

# 打包 .clip
package: build ui
	@mkdir -p dist
	zip -r dist/my-clip.clip clip.yaml commands/ bin/ web/ seed/ -x '*.DS_Store'
	@echo "Install: pinix clip install dist/my-clip.clip --server URL --token TOKEN"

clean:
	rm -rf bin/ dist/ web/
```

### 部署流程

```bash
# 开发模式（Pinix 直接读 workdir，改了立即生效）
pinix clip create my-clip --workdir /path/to/my-clip

# 打包模式（.clip 文件安装/升级）
make package
pinix clip install dist/my-clip.clip --server http://host:port --token SUPER_TOKEN
pinix clip upgrade dist/my-clip.clip --server http://host:port --token SUPER_TOKEN
```

## 在 Sandbox 中开发 Clip

1. **创建项目**
```
clip sandbox bash "mkdir -p ~/my-clip/commands && cd ~/my-clip && cat > clip.yaml << 'EOF'
name: my-clip
description: ...
version: 0.1.0
hasWeb: false
EOF"
```

2. **写命令** — 每个命令一个文件，记得 `chmod +x`

3. **测试** — 直接用 `pinix invoke` 或 dev workdir 模式

4. **打包** — `zip -r /tmp/my-clip.clip clip.yaml commands/ ...`

5. **部署** — `pinix clip install /tmp/my-clip.clip --server ... --token ...`

## 常见坑

- **Python stdin 阻塞**：必须用 `select.select()` 非阻塞读取，不能用 `json.load(sys.stdin)`
- **Go 交叉编译**：必须 `CGO_ENABLED=0 GOOS=linux GOARCH=arm64`（BoxLite 是 ARM64 Linux）
- **Shell shebang**：必须 `#!/bin/sh` 不能 `#\!/bin/sh`（转义会导致 kernel 不识别）
- **命令权限**：`commands/` 下的文件必须 `chmod +x`
- **VM 持久化**：BoxLite 文件系统持久——装一次依赖后续不用重装
- **数据目录**：运行时数据放 `data/`，初始数据放 `seed/`
