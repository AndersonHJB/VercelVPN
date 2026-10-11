# Vercel YAML Expiring Links

部署在 Vercel 上的 YAML 订阅链接管理器。管理员可以生成订阅、查询状态、延长有效期和关闭订阅。订阅数据支持存入 GitHub 私有仓库，两个部署可以共用同一份数据。

当前部署：

- <https://v.bornforthis.cn>
- <https://v.other.us.brclio.com>

两个域名目前绑定到同一个 Vercel 项目 `bornforthis1/vercel-vpn`，共用服务端存储配置。

## 存储与旧链接兼容

启用 GitHub 存储后，新生成的订阅会保存到私有仓库；输入正确的管理员密码后，管理页自动读取共享订阅列表。现有两个域名的浏览器历史已经迁移完成。服务端按完整 token 的 SHA-256 合并记录，保留原 token、原订阅地址以及已保存的多个地址。

- **续期保持原 URL**：只修改仓库中的有效期，使用者无需更换订阅链接。已过期的订阅也可以续期。
- **关闭订阅**：状态保存到仓库，两个部署访问同一 token 都返回 `410 Gone`。已关闭订阅不能续期。
- **重复同步**：已有记录保留云端的有效期、备注和关闭状态，旧浏览器缓存不会覆盖云端变更。
- **尚未迁移的旧链接**：继续用原部署的 `LINK_SECRET` 校验签名和原有效期。
- **两个部署密钥不同**：首次迁移需要在最初生成链接的域名操作。通过签名验证并入库后，另一部署可以按完全相同的 token 查询、续期、关闭和访问。

**请保留两个部署各自现有的 `LINK_SECRET`，不要为了共用仓库修改密钥。** 已入库记录是共享授权依据，后续轮换密钥只影响尚未入库的旧链接；关闭已托管订阅请使用管理页或关闭接口。

未配置 GitHub 存储时，继续保留原模式：历史记录只存浏览器，续期会生成新的替代链接，单链接关闭使用原有 KV/Upstash 或本地撤销文件。

## 配置 GitHub 私有仓库

数据仓库：[`AndersonHJB/vpn-userdata`](https://github.com/AndersonHJB/vpn-userdata)。服务端会检查仓库为私有，公开仓库会被拒绝。

1. 确认仓库已经初始化，并且存在 `main` 分支。空仓库可先在 GitHub 添加 README 产生首次提交。
2. 在 GitHub 创建 fine-grained personal access token，只选择这个数据仓库，授予仓库权限 **Contents: Read and write**。令牌需要能读取仓库信息和分支；GitHub 的 Metadata 读取权限随仓库授权提供。
3. 在 Vercel 项目设置以下服务端环境变量；如果使用多个项目，需要分别配置相同的数据仓库：

```dotenv
GITHUB_STORAGE_REPO=AndersonHJB/vpn-userdata
GITHUB_STORAGE_TOKEN=填写你自己的私有仓库令牌
GITHUB_STORAGE_BRANCH=main
GITHUB_STORAGE_PATH=subscriptions/links.json
```

`GITHUB_STORAGE_BRANCH` 默认是 `main`，`GITHUB_STORAGE_PATH` 默认是 `subscriptions/links.json`。文件可以不存在，首次成功写入时自动创建；分支必须事先存在。两个部署必须使用相同的仓库、分支和文件路径。

令牌只放在服务端环境变量中，不要使用 `NEXT_PUBLIC_` 前缀，不要提交到代码仓库，也不要填入浏览器管理页。保留现有 `ADMIN_PASSWORD`、`LINK_SECRET`、YAML 来源及旧撤销存储配置。更新环境变量后重新部署对应项目。

## 管理页读取与保存

两个域名的浏览器缓存已完成迁移，管理页不再提供旧缓存上传按钮。输入正确的管理员密码后会读取 GitHub；记住密码时，重新打开管理页也会读取一次。后续可通过刷新列表按钮主动获取最新数据。

输入管理员密码后读取一次共享列表。生成、续期、关闭操作会立即保存到私有仓库，并在操作结束后刷新列表。需要查看另一域名或设备的修改时，点击 **刷新列表**。页面空闲和切换窗口不会发起额外读取；读取失败后可点击刷新列表重试。

云端读取失败时保留当前列表与本机缓存，并显示连接状态。后台刷新不会阻塞管理表单。同步保留原 token、原 URL 和已关闭状态，不会重签名、替换用户已收到的链接或用旧缓存覆盖云端期限。

浏览器缓存仍按域名隔离，读取云端时会合并本机独有记录。清空本地列表只影响当前浏览器，不删除 GitHub 中的订阅；点击刷新列表可恢复云端记录。历史仍支持搜索、分页及 CSV、JSON、TXT 导出。

如以后需要补迁移其他浏览器中尚未入库的历史，服务端仍保留 `POST /api/subscriptions` 的 `action: "sync"` 接口，每批最多 200 条。首次导入需在原域名验证旧签名，有效期取自原 token；已入库记录保留云端的期限、备注和关闭状态。管理页不会自动上传旧缓存。

## 续期、关闭与访问

生成、查询、续期、关闭和列表读取都需要管理员密码。访问订阅 URL 本身使用 token 授权。

续期可在列表中点击“续期”，或在“延长已有链接”中粘贴完整旧 URL：

- 未过期：从原过期时间继续增加。
- 已过期：从当前时间继续增加。
- 指定时间：必须晚于当前时间及原过期时间。
- 启用 GitHub 存储后：更新原 token 对应记录，原 URL 保持可用，并返回新的到期时间。
- 未启用 GitHub 存储时：生成新的替代 URL，需要将新地址交给使用者。

关闭可使用列表中的“失效”按钮或“失效已有链接”表单。关闭和过期的订阅访问均返回 `410 Gone`；有效订阅返回 YAML，并在 `subscription-userinfo` 响应头中提供实际到期时间。

两个部署共用托管 token 的授权，但各自仍使用自身配置的 YAML 来源。需要提供相同内容时，请确保两边 YAML 来源一致。

## 以后只保留一个部署

先在两个域名完成同步，确认保留部署可以读取、续期和关闭双方迁移的记录。随后将被撤掉部署的**原域名也绑定并指向保留部署**，验证原订阅 URL 仍可访问，再删除旧项目。

用户手中的完整 URL 包含域名。仅迁移数据不能替代域名路由；要保留旧链接，旧域名需要继续提供访问入口。

## 存储故障和容量

配置了 GitHub 存储后，服务端在订阅访问及管理操作中读取仓库。连接超时、权限错误、分支不存在、数据文件损坏或 API 配额不足时返回 `503`，不会退回原签名放行，以保证已关闭订阅不会因故障恢复访问。管理页保留浏览器缓存，修复配置后可以重试。恢复服务应修复仓库访问，保留存储配置和现有数据。

写入使用 GitHub 文件 SHA 检测并发修改，冲突时读取最新版本重试；管理页续期请求携带操作标识，避免同一次请求重试重复加时。

本实现适合小型部署：每次访问会消耗 GitHub API 请求配额，整份订阅文件单次写入上限为 **900,000 字节**。超过限制会取消写入；高频访问或更大规模应先改用分片存储或数据库。私有仓库中的 URL 和 token 是订阅访问凭证，应限制仓库和令牌的访问权限。

## 本地运行

建议使用 Node.js 20 或更新版本。

```bash
npm install
cp .env.example .env.local
openssl rand -base64 32
```

在 `.env.local` 设置 `ADMIN_PASSWORD` 和至少 32 个字符的 `LINK_SECRET`。新环境可以用上面的命令生成密钥；已有部署必须保留原密钥。需要 GitHub 存储时取消示例中相关变量的注释并填写令牌。

YAML 来源按以下优先级选择：

1. `YAML_CONTENT`：完整 YAML 文本。
2. `YAML_SOURCE_URL`：远程 YAML URL。
3. `YAML_FILE_PATH`：本地 YAML 文件，或仅包含一条远程 YAML URL 的 txt 文件。

本地文件示例：

```bash
cp data/subscription.example.yaml data/subscription.yaml
# 或使用 data/iggfeed.example.txt 创建自己的本地 URL 文件。
npm run dev
```

打开 <http://localhost:3000>。真实 YAML、上游 URL、密码、令牌和 `.env.local` 都不应提交到公开仓库，YAML 不应放入 `public/`。

本地未启用 GitHub 时，撤销记录默认存于 `data/revoked-links.json`。Vercel 未启用 GitHub 时，如需单链接关闭，应配置 `KV_REST_API_URL` / `KV_REST_API_TOKEN`，或 `LINK_REVOCATION_UPSTASH_REST_URL` / `LINK_REVOCATION_UPSTASH_REST_TOKEN`；Vercel 实例本地文件不能可靠持久化。启用 GitHub 后仍会检查已有的撤销存储，迁移期间请保留原配置。

## 部署与验证

将代码推送到 GitHub，在 Vercel 导入 Next.js 项目，设置上述服务端环境变量及 YAML 来源后部署。后续代码更新可通过 Git 推送触发部署；修改环境变量后需要重新部署。

```bash
npm run typecheck
npm run build
npm audit --omit=dev
```

上线后验证密码输入后的一次读取、操作结束更新和刷新列表按钮，再检查原 URL 续期、关闭及双域访问。使用独立测试订阅验证写操作，避免修改现有用户的订阅。

## 主要接口

| 接口 | 用途 |
| --- | --- |
| `POST /api/links` | 生成订阅，启用存储时自动入库 |
| `POST /api/subscriptions` | `action: "list"` 读取，`action: "sync"` 合并浏览器历史 |
| `POST /api/link-status` | 查询状态和实际有效期 |
| `POST /api/extend-link` | 续期；启用存储时保留原 token |
| `POST /api/invalidate-link` | 关闭订阅 |
| `GET /api/subscription/[token]` | 校验托管状态或旧签名后返回 YAML |

管理接口均通过 JSON 请求体中的 `password` 校验管理员密码。GitHub 存储实现在 `lib/github-store.ts`，共享订阅规则在 `lib/subscriptions.ts`，旧撤销存储兼容逻辑在 `lib/revoked-links.ts`。
