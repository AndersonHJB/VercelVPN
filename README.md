# Vercel YAML Expiring Links

一个部署在 Vercel 上的限时 YAML 访问服务。管理员可以生成不同有效期的链接，用户访问链接时，服务端会先校验签名和过期时间，校验通过才返回 YAML 内容。

## 功能

- 为同一个 YAML 文件生成多个不同有效期的链接。
- 对某个已有链接增加有效期。
- 已过期但签名有效的链接，也可以由管理员延长并生成新的替代链接。
- 链接过期后返回 `410 Gone`，不再暴露 YAML 内容。
- 无数据库：链接 token 使用 `LINK_SECRET` 做 HMAC 签名。
- 管理页需要 `ADMIN_PASSWORD` 才能生成链接。
- YAML 不放在 `public/`，避免绕过服务端校验。

## 工作原理

1. 管理页提交管理员密码和有效期到 `/api/links`。
2. 服务端生成包含 `iat`、`exp`、`nonce` 的 payload。
3. payload 会用 `LINK_SECRET` 签名，形成不可篡改 token。
4. 用户访问 `/api/subscription/[token]`。
5. 服务端验证签名和 `exp`。
6. 验证通过返回 `text/yaml`，过期返回 `410 Gone`。

延长已有链接时，管理页会提交旧链接到 `/api/extend-link`。服务端会允许解析“已过期但签名仍有效”的 token，然后生成一个新的替代链接：

- 旧链接未过期：在旧链接原过期时间基础上增加时长。
- 旧链接已过期：从当前时间开始增加时长。
- 指定新的过期时间时，新时间必须晚于旧过期时间或当前时间。

这个方案是无状态的，所以不能原地修改同一个 URL，也不能单独提前撤销某一个链接。需要让所有已生成链接立即失效时，修改 Vercel 环境变量里的 `LINK_SECRET` 并重新部署。

## 本地运行教程

### 1. 安装 Node.js

建议使用 Node.js 20 或更新版本。

查看本机版本：

```bash
node -v
npm -v
```

### 2. 安装依赖

```bash
npm install
```

### 3. 创建本地环境变量

```bash
cp .env.example .env.local
openssl rand -base64 32
```

打开 `.env.local`，至少设置：

```bash
ADMIN_PASSWORD=你的管理员密码
LINK_SECRET=刚才 openssl 生成的随机字符串
YAML_FILE_PATH=data/subscription.yaml
MAX_LINK_TTL_DAYS=365
```

`LINK_SECRET` 至少 32 个字符。不要把 `.env.local` 提交到 GitHub。

### 4. 放入 YAML 文件

本地开发可以复制示例文件：

```bash
cp data/subscription.example.yaml data/subscription.yaml
```

然后把 `data/subscription.yaml` 替换成你的真实 YAML 内容。

注意：`data/subscription.yaml` 已经在 `.gitignore` 里，不会被提交。不要把真实 YAML 放到 `public/` 目录。

### 5. 启动本地服务

```bash
npm run dev
```

浏览器打开：

```text
http://localhost:3000
```

输入管理员密码，选择有效期，生成链接。复制生成的链接后，在浏览器或客户端里访问即可得到 YAML。

## GitHub 推送教程

如果你需要重新创建并推送到 GitHub，可以按下面做。

### 1. 登录 GitHub CLI

```bash
gh auth login
gh auth status
```

### 2. 初始化 Git

```bash
git init
git branch -M main
git add .
git commit -m "Initial Vercel YAML link manager"
```

### 3. 创建远端仓库并推送

公开仓库：

```bash
gh repo create VercelVPN --public --source=. --remote=origin --push
```

私有仓库：

```bash
gh repo create VercelVPN --private --source=. --remote=origin --push
```

如果远端已经存在：

```bash
git remote add origin git@github.com:你的用户名/VercelVPN.git
git push -u origin main
```

GitHub CLI 官方文档：<https://cli.github.com/manual/gh_repo_create>

## Vercel 手把手部署教程

### 1. 准备 GitHub 仓库

确认代码已经推送到 GitHub，并且仓库里不要包含：

- `.env`
- `.env.local`
- `data/subscription.yaml`
- 任何真实密码、token、订阅链接或密钥

### 2. 打开 Vercel

进入 Vercel Dashboard：

```text
https://vercel.com/dashboard
```

点击右上角 `New Project`。

### 3. 导入 GitHub 仓库

1. 选择 GitHub。
2. 找到 `VercelVPN` 仓库。
3. 点击 `Import`。
4. Framework Preset 选择 `Next.js`。
5. Root Directory 保持默认项目根目录。
6. Build Command 保持默认 `next build`。
7. Output Directory 留空。

Vercel Git 部署文档：<https://vercel.com/docs/git>

### 4. 配置环境变量

在导入项目页面的 `Environment Variables` 区域添加：

```bash
ADMIN_PASSWORD=你的管理员密码
LINK_SECRET=至少32字符的随机字符串
YAML_CONTENT=你的完整YAML内容
MAX_LINK_TTL_DAYS=365
```

推荐在 Vercel 上使用 `YAML_CONTENT`，不要依赖 `data/subscription.yaml`，因为真实 YAML 不应该提交到 GitHub。

生成 `LINK_SECRET` 的命令：

```bash
openssl rand -base64 32
```

Vercel 的 Node.js 环境变量总大小限制是 64KB。如果你的 YAML 很大，`YAML_CONTENT` 放不下，需要改成外部存储方案，例如 Vercel Blob、数据库或受保护的对象存储。

Vercel 环境变量文档：<https://vercel.com/docs/environment-variables>

### 5. 点击 Deploy

点击 `Deploy`，等待构建完成。

部署成功后，Vercel 会给你一个域名，例如：

```text
https://your-project.vercel.app
```

打开这个域名就是管理页。

### 6. 后续更新

以后修改代码后：

```bash
git add .
git commit -m "Update app"
git push
```

Vercel 会自动从 GitHub 触发新的部署。环境变量修改后，只会影响新的部署；如果改了环境变量，请在 Vercel 里重新部署一次。

## 使用教程

### 生成限时链接

1. 打开你的 Vercel 域名。
2. 在 `管理员密码` 输入 `ADMIN_PASSWORD`。
3. `链接备注` 可以写客户名、设备名或用途。
4. 选择 `按时长` 或 `指定时间`。
5. 点击 `生成链接`。
6. 点击 `复制`。

### 访问 YAML

生成的链接类似：

```text
https://your-project.vercel.app/api/subscription/eyJ2Ijox...
```

访问这个链接时：

- 未过期：返回 YAML 内容。
- 已过期：返回 `This link has expired.` 和 HTTP `410`。
- token 被改动：返回 `Invalid link.` 和 HTTP `403` 或 `400`。

### 给不同用户设置不同有效期

示例：

- 临时测试：30 分钟。
- 短期用户：7 天。
- 长期用户：30 天。

每次生成的链接都有独立 token。即使有效期相同，链接也不同。

### 延长已有链接

1. 打开你的 Vercel 域名。
2. 找到 `延长已有链接` 区域。
3. 输入 `ADMIN_PASSWORD`。
4. 粘贴完整旧链接，或只粘贴 token。
5. 可选填写 `新备注`，留空会沿用旧备注。
6. 选择 `按时长` 或 `指定时间`。
7. 点击 `延长并生成新链接`。
8. 复制新生成的替代链接发给使用者。

延长规则：

- 旧链接还没过期：例如原本明天过期，增加 7 天后，会变成从明天再往后 7 天。
- 旧链接已经过期：例如昨天过期，增加 7 天后，会变成从现在开始 7 天。
- 旧链接 token 被篡改：不能延长，会返回 `Invalid link.`。

注意：延长后得到的是新 URL，旧 URL 不会变。无数据库版本无法让旧 URL 原地恢复可用。

### 立即让所有链接失效

1. 打开 Vercel 项目设置。
2. 找到 `Environment Variables`。
3. 修改 `LINK_SECRET` 为新的随机字符串。
4. 重新部署项目。

完成后，旧链接都会变成无效链接。

## 安全注意事项

- 不要把真实 YAML 放进 `public/`。
- 不要提交 `.env.local`。
- 不要把 `ADMIN_PASSWORD` 和 `LINK_SECRET` 发给使用者。
- `LINK_SECRET` 改了以后，所有旧链接都会失效。
- 无数据库版本不能原地修改旧 URL，也不能单独撤销某一个链接。
- 如果要支持单个链接撤销、访问次数限制、用户列表、访问日志，需要增加数据库。

## 常用命令

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm audit --omit=dev
```

## 项目结构

```text
app/
  api/
    links/route.ts                 # 生成签名链接
    extend-link/route.ts           # 延长已有链接并生成替代链接
    subscription/[token]/route.ts  # 校验 token 并返回 YAML
  page.tsx                         # 管理页面
lib/
  auth.ts                          # 管理员密码校验
  link-admin.ts                    # 链接生成和延长的通用规则
  token.ts                         # HMAC token 签名和验证
  yaml.ts                          # 读取 YAML_CONTENT 或 YAML_FILE_PATH
data/
  subscription.example.yaml        # 示例 YAML
```
