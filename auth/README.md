# 账号登录

首页的「登录 / 注册」打开 `auth/preview.html`。游客可以直接练习；登录页不会自动打开，也不会读取或上传 `koreanSite_zhcn_draft_v01`。

现在邮箱和密码可以真正注册、登录：Supabase Auth 邮箱提供方已开启，项目 `韩语学习网站`（ref `fehowefhgzjmdlpaoqig`）的公开 URL 和 publishable key 已写在 `auth/public-config.js`。

## 为什么注册不需要确认邮件

线上项目的自定义 SMTP 还没有配置，`customSmtpConfigured` 仍是 `false`。Dashboard 的 Confirm email 开关也还是开着（公开 Auth settings 返回 `mailer_autoconfirm: false`），而这次 Management API 不可用，无法改这个开关。

因此线上走的是数据库触发器，不是邮件确认：

- schema `internal_auth`（未授权给 anon / authenticated）
- 函数 `internal_auth.autoconfirm_email_user()`，`SECURITY DEFINER`，在 `BEFORE INSERT` 时把有邮箱且 `email_confirmed_at` 为空的 `NEW.email_confirmed_at` 设为当前时间
- 触发器 `autoconfirm_email_user`，挂在 `auth.users`
- 完整 SQL 见 `api/sql/auth-autoconfirm-email.sql`

已用线上 Auth API 验证：`signUp` 会直接返回 session，`signInWithPassword` 也能登录新用户。测试用户已删除。

配置好自定义 SMTP，并把 Confirm email 重新打开后，**要删除这个触发器**（SQL 文件末尾有删除语句）。在那之前，不要把它当成正式的邮箱确认流程。

## 现在真实可用 / 仍不可用

| 动作 | 现在 |
| --- | --- |
| 游客继续练习 | 可用。不登录、不弹窗、不读取或上传学习记录 |
| 邮箱密码注册 | 可用。触发器直接确认邮箱，注册后即登录 |
| 邮箱密码登录 | 可用。会话保存在 `korean-site-auth-session` |
| 刷新后恢复会话 | 首页和登录页都读同一个 `korean-site-auth-session`；登录页用 `getUser()` 核对 |
| 退出 | 登录页用 `scope: 'local'` 退出，只清这个浏览器。学习记录不删 |
| 找回密码 | **还不可用。** 没有自定义 SMTP，重置邮件送不到普通访客邮箱。页面会如实说明，不假装邮件会到 |
| 手机短信 | 没有短信服务商，页面不显示入口。`000000` 不是验证码，任何路径都不接受 |
| 微信 / QQ / Kakao | 没有应用凭据，页面不显示这些按钮 |
| 云同步 | 没有实现。会话不等于云同步，学习记录仍只在本机 |

首页的账号按钮只认真实会话，不认旧的本地手机号演示账号。旧的 `koreanSite_zhcn_draft_v01_accounts` 数据不会被删除，但不能再让任何人登录。AI 导师也只认 `korean-site-auth-session`；会员和 AI 额度仍由服务端校验，购买 / 结账尚未实现。详见 `api/README.md` 与 `api/sql/ai-membership.sql`。

## 公开配置

只把可公开的值写进 `auth/public-config.js`。不要把 `sb_secret_...` 或 `service_role` 交给这个文件；`auth/config.js` 会拒绝它们，不会拿去创建客户端。

`auth/public-config.js` 当前字段：

- `supabaseUrl`: `https://fehowefhgzjmdlpaoqig.supabase.co`
- `supabasePublishableKey`: 只有 publishable key
- `customSmtpConfigured`: `false`
- `smsProviderConfigured`: `false`
- `social.wechat/qq/kakao.configured`: `false`
- `cloudSyncConsent`: `false`

## 还需要在 Dashboard 确认的配置

1. Authentication → URL Configuration：
   - Site URL 设成 `https://korean-site-zhcn.vercel.app/auth/preview.html`，避免没带 `redirectTo` 时落到默认的 `localhost:3000`。
   - Redirect URLs 精确加入：
     - `https://korean-site-zhcn.vercel.app/auth/preview.html`
     - `https://korean-site-zhcn.vercel.app/auth/recovery.html`
     - `https://macshi716.github.io/korean-site-zhcn/auth/preview.html`
     - `https://macshi716.github.io/korean-site-zhcn/auth/recovery.html`
     - 本地预览再加 `http://127.0.0.1:8765/auth/preview.html` 和 `http://127.0.0.1:8765/auth/recovery.html`
   - 两个生产域名只有一个 Site URL。漏掉白名单时，Supabase 会静默回到 Site URL。
2. 找回密码：自备发信域名和自定义 SMTP，再把 `customSmtpConfigured` 改成 `true`。在那之前不要期待任意邮箱能收到重置信。默认 SMTP 大约每小时 2 封，且只发给组织成员，错误码是 `email_address_not_authorized`。
3. 配好自定义 SMTP 后：打开 Confirm email 的正式流程，删除 `autoconfirm_email_user` 触发器，再按真实邮件确认路径联调。
4. 手机：在 Twilio、MessageBird、Vonage 或 TextLocal 开通并写入 Dashboard 之后，才把 `smsProviderConfigured` 改成 `true`。官方测试号码是另一套 Dashboard 配置，不能用 `000000` 代替。
5. Kakao：在 Kakao Developers 创建应用，把 REST API key / Client Secret 填进 Supabase 的 Kakao 提供方，回调是 `https://<项目>.supabase.co/auth/v1/callback`，不是 Pages 或 Vercel 地址。完成后再改 `social.kakao.configured`。微信和 QQ 需要你自己的开放平台应用，而且不是 Supabase 内置提供方。

## 本地预览与测试

本地看界面：

```bash
python3 -m http.server 8765
```

打开 `http://127.0.0.1:8765/auth/preview.html`。合成内存账号只在本机 `http://127.0.0.1:8765/auth/preview.html?harness=1` 出现；这个开关在 Vercel、GitHub Pages 和 `localhost` 上无效，也不会发信。

在仓库根目录运行：

```bash
node --test --test-concurrency=1 auth/tests/auth-service.test.js
node --test --test-concurrency=1 tests/*.mjs auth/tests/*.js
```

单元测试使用注入的假客户端和内存账号，不会访问 Supabase，也不会发邮件或短信。页面测试使用临时 Chrome 配置和本机静态服务器。

## 首页怎么读会话

首页是传统脚本，登录模块是 ESM，所以首页只用一个小模块 bootstrap（`auth/site-session.js`）读 `korean-site-auth-session`：

- 已登录：顶部按钮显示打码邮箱，点击进入设置；设置里的账号卡片用同一份真实会话。
- 未登录：按钮显示「登录 / 注册」，点击跳到 `auth/preview.html`。
- 退出在登录页完成；回到首页时会话已清掉，按钮恢复未登录。
- 首页加载时不会设置 `body.auth-locked`，也不会打开旧演示弹窗。旧 `loginWithDemoCode` 只是拒绝路径，不写会话。

学习数据仍然是 `koreanSite_zhcn_draft_v01`。云同步要另一次明确同意，并且先做 RLS，再谈上传。这次没有建表。

## 官方来源（2026-11-20 核对）

- 密码登录与重置：https://supabase.com/docs/guides/auth/passwords
- PKCE（浏览器 `exchangeCodeForSession`）：https://supabase.com/docs/guides/auth/sessions/pkce-flow
- 退出范围：https://supabase.com/docs/guides/auth/signout
- `getUser()` 会向 Auth 服务器核对：https://supabase.com/docs/reference/javascript/auth-getuser
- 重定向白名单：https://supabase.com/docs/guides/auth/redirect-urls
- 默认 SMTP 只发给组织成员、约每小时 2 封：https://supabase.com/docs/guides/auth/auth-smtp
- 速率限制（邮件 2 封/小时）：https://supabase.com/docs/guides/auth/rate-limits
- 邮件模板与浏览器 `verifyOtp({ token_hash })`：https://supabase.com/docs/guides/auth/auth-email-templates
- 免费项目默认 SMTP 不能改模板（2026-06-03）：https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier
- 手机登录与短信商：https://supabase.com/docs/guides/auth/phone-login
- 密码至少建议 8 位：https://supabase.com/docs/guides/auth/password-security
- 可公开 key 与 secret：https://supabase.com/docs/guides/api/api-keys
- 错误码：https://supabase.com/docs/guides/auth/debugging/error-codes
- 区域 Seoul `ap-northeast-2`：https://supabase.com/docs/guides/platform/regions
- 社交列表（有 Kakao，没有微信/QQ）：https://supabase.com/docs/guides/auth/social-sign-in
- Kakao：https://supabase.com/docs/guides/auth/social-sign-in/auth-kakao
- 客户端版本：npm `@supabase/supabase-js@2.119.2`，页面按这个版本从 jsDelivr 加载。

## 仍然存在的限制

1. 没有自定义 SMTP，所以找回密码邮件不能送到普通访客邮箱。
2. 没有短信商。手机登录不可用，`000000` 永远不接受。
3. 没有 Kakao 应用。微信和 QQ 不是内置提供方，也没有凭据。
4. 大陆网络能否访问 `*.supabase.co` 这次没有测。
