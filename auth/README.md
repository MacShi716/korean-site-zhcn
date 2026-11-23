# 账号登录

首页的「登录 / 注册」打开 `auth/preview.html`。游客可以返回继续学习。这个页面不读取、不上传 `koreanSite_zhcn_draft_v01`。

公网邮箱验证和找回密码所需的自定义发信与回调白名单还没配完。短信、第三方登录和云同步未启用。

在本目录运行测试：

```bash
node --test auth/tests/auth-service.test.js
```

测试使用注入的假客户端和内存账号，不会访问 Supabase，也不会发邮件或短信。没有项目 URL 和 publishable key，所以**不能**把这次结果说成真实端到端登录已经通过。

## 和另一份研究的差异（已按官方文档核对）

研究稿把 PKCE 写成必须有服务端。当前官方 PKCE 文档不是这个意思：浏览器里的 `createClient` 可以设 `flowType: 'pkce'`，再用 `exchangeCodeForSession(code)` 兑换。文档里 “server side” 那句说的是服务端跑这条流程时 `localStorage` 可能不存在，需要换存储；同一页给出了浏览器初始化示例。

这份草稿因此用 **浏览器 PKCE**，不引入后端，也不用 implicit：

- implicit 会把 `access_token` 和 `refresh_token` 放进地址栏 hash。草稿拒绝保存这种令牌。
- PKCE 的 code 大约 5 分钟、只能兑换一次，验证码 verifier 留在发起请求的那个浏览器。官方限制：换浏览器或换设备会失败（`bad_code_verifier`）。
- `detectSessionInUrl` 设为 `false`。邮件安全扫描如果只打开链接，页面本身不兑换。用户要点「这是我点开的邮件链接，继续」才会调用 `exchangeCodeForSession` 或 `verifyOtp`。
- 若链接带 `token_hash` 和 `type`，在浏览器里调用 `verifyOtp`。官方邮件模板文档的示例用的就是 `window.location`，不要求自建服务器。新的免费项目在默认 SMTP 下不能改邮件模板（2026-06-03 变更），所以默认确认信通常仍是 `ConfirmationURL`，同浏览器 PKCE 可用；跨设备的 `token_hash` 链接要等自定义 SMTP（或付费计划）允许改模板之后。

回跳地址不是站点根目录。`index.html` 还不会兑换 code。注册回到 `auth/preview.html`，重置回到 `auth/recovery.html`。

## 现在就能用的行为

| 动作 | 缺配置时 | 配置齐了之后 |
| --- | --- | --- |
| 游客继续学习 | 可用，不读不写学习记录 | 同左 |
| 邮箱密码登录、退出、刷新后用 `getUser()` 核对会话 | 停住 | 会调用 Auth。退出只用 `scope: 'local'`，不取消其他设备 |
| 注册、密码重置 | 公开配置齐全时会调用接口。`mailer_autoconfirm === false` 且没有自定义 SMTP 时，只适合管理员邮箱联调，页面写明公网发信未就绪。后台关掉 Confirm email（`mailer_autoconfirm === true`）后，邮箱和密码可以直接注册登录；找回密码和邮箱验证仍标明待配 SMTP | 仅当 `customSmtpConfigured: true` 才把公网发信当成已就绪 |
| 手机号 + 区号 | 保留输入。没有短信商时不调用 `signInWithOtp`。`000000` 永远失败 | 仅当 `smsProviderConfigured: true` 才把号码拼成 E.164 后调用。`000000` 仍然直接拒绝 |
| 微信 / QQ | 停住，不跳转 | 官方没有内置提供方。即使把配置标成 true 也不会调用 |
| Kakao | 停住，不跳转 | 仅当 `social.kakao.configured: true` 才 `signInWithOAuth({ provider: 'kakao' })`。点击当时还不算已登录 |
| 云同步 | 没有实现。`cloudSyncConsent: true` 也不会上传 | 同左 |

会话存在单独的 `korean-site-auth-session`。读写会拒绝 `koreanSite_zhcn_draft_v01` 及其账号钥匙。不会把游客进度拷进账号。

## 你需要补上的配置

只把可公开的值写进 `auth/public-config.js`。不要把 `sb_secret_...` 或 `service_role` 交给这个文件；草稿会拒绝它们，不会拿去创建客户端。

1. Supabase connector 仍待你授权。这次没有建项目，也没有改 Dashboard。
2. 新建 **Free** 项目时选 **Northeast Asia (Seoul) / `ap-northeast-2`**。不要选会落到新加坡的 APAC 通用区域。区域选定后的迁移不在这次草稿里。
3. 公开配置使用现有项目 `https://fehowefhgzjmdlpaoqig.supabase.co` 和 `supabasePublishableKey`。旧字段名 `publishableKey` 仍可作为兼容读取。不要写入 secret。
4. Authentication → URL Configuration：
   - Site URL 先设成 `https://korean-site-zhcn.vercel.app/auth/preview.html`，避免没带 `redirectTo` 时落到默认的 `localhost:3000`。
   - Redirect URLs 精确加入：
     - `https://korean-site-zhcn.vercel.app/auth/preview.html`
     - `https://korean-site-zhcn.vercel.app/auth/recovery.html`
     - `https://macshi716.github.io/korean-site-zhcn/auth/preview.html`
     - `https://macshi716.github.io/korean-site-zhcn/auth/recovery.html`
     - 本地预览再用 `http://127.0.0.1:8765/auth/preview.html` 和 `http://127.0.0.1:8765/auth/recovery.html`
   - 两个生产域名只有一个 Site URL。漏掉白名单时，Supabase 会静默回到 Site URL。
5. 公众注册和找回密码：自备发信域名和自定义 SMTP，再把 `customSmtpConfigured` 改成 `true`。在那之前不要期待任意邮箱能收到信。默认 SMTP 大约每小时 2 封，且只发给组织成员，错误码是 `email_address_not_authorized`。这一步会真正发信，等你明确安排再打开。
6. 保持托管项目的 Confirm email 开启。关掉它会让未持有的邮箱被标成已确认，这份草稿没有提供这个开关。
7. 手机：在 Twilio、MessageBird、Vonage 或 TextLocal 开通并写入 Dashboard 之后，才把 `smsProviderConfigured` 改成 `true`。短信费在短信商，不包含在 Supabase Free。官方测试号码是另一套 Dashboard 配置，这份草稿没有启用，也不能用 `000000` 代替。
8. Kakao：在 Kakao Developers 创建应用，把 REST API key / Client Secret 填进 Supabase 的 Kakao 提供方，回调是 `https://<项目>.supabase.co/auth/v1/callback`，不是 Pages 或 Vercel 地址。完成后再把 `social.kakao.configured` 改成 `true`。
9. 微信和 QQ 需要你自己的开放平台应用，而且不是 Supabase 内置提供方。没有凭据就不会接通。

本地看界面：

```bash
python3 -m http.server 8765
```

打开 `http://127.0.0.1:8765/auth/preview.html`。要看合成账号流程，只能在本机打开 `http://127.0.0.1:8765/auth/preview.html?harness=1`。这个开关在 Vercel 和 GitHub Pages 上无效。

## 将来接到首页的最小改动

不要为了接入去改练习、词库或模型。等首页那一侧稳定后，只替换 `index.html` 里这几个函数的函数体，并让它们调用 `auth/future-adapter.js`：

- `loginWithDemoCode`：不要再接受 `000000`，也不要再把游客 `state` 复制进新账号（现有大约 2091–2095 行的复制）。
- `socialLogin`
- `logoutAuth`
- `enterAsGuest`

邮件回跳可以继续落在 `auth/preview.html` 和 `auth/recovery.html`，直到首页自己学会兑换 PKCE code。学习数据仍用 `koreanSite_zhcn_draft_v01`。云同步要另一次明确同意，并且先做 RLS，再谈上传。这次没有建表。

## 官方来源（2026-11-20 核对）

- 密码登录与重置：https://supabase.com/docs/guides/auth/passwords
- PKCE（浏览器 `exchangeCodeForSession`）：https://supabase.com/docs/guides/auth/sessions/pkce-flow
- 退出范围：https://supabase.com/docs/guides/auth/signout
- `getUser()` 会向 Auth 服务器核对：https://supabase.com/docs/reference/javascript/auth-getuser
- 重定向白名单：https://supabase.com/docs/guides/auth/redirect-urls
- 默认 SMTP 只发给组织成员、约每小时 2 封：https://supabase.com/docs/guides/auth/auth-smtp
- 速率限制（邮件 2 封/小时、短信默认 30 条/小时）：https://supabase.com/docs/guides/auth/rate-limits
- 邮件模板与浏览器 `verifyOtp({ token_hash })`：https://supabase.com/docs/guides/auth/auth-email-templates
- 免费项目默认 SMTP 不能改模板（2026-06-03）：https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier
- 手机登录与短信商：https://supabase.com/docs/guides/auth/phone-login
- 密码至少建议 8 位；泄露密码库是 Pro 才有：https://supabase.com/docs/guides/auth/password-security
- 可公开 key 与 secret：https://supabase.com/docs/guides/api/api-keys
- 错误码：https://supabase.com/docs/guides/auth/debugging/error-codes
- 区域 Seoul `ap-northeast-2`：https://supabase.com/docs/guides/platform/regions
- Free 计划 Auth MAU 50,000：https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users
- 社交列表（有 Kakao，没有微信/QQ）：https://supabase.com/docs/guides/auth/social-sign-in
- Kakao：https://supabase.com/docs/guides/auth/social-sign-in/auth-kakao
- 自定义 OAuth：https://supabase.com/docs/guides/auth/custom-oauth-providers
- 客户端版本：npm `@supabase/supabase-js@2.119.2`，页面按这个版本从 jsDelivr 加载。
- 官方示例没有仍在维护的单 HTML 完整应用。对照的是文档里的 JavaScript 片段，以及 https://github.com/supabase/supabase/tree/master/examples/user-management 和 https://github.com/supabase/supabase/tree/master/examples/auth 。没有引入 `@supabase/ssr`。

## 仍然阻塞真实端到端

1. Supabase connector 未完成授权，没有项目 URL，没有 publishable key。
2. 没有自定义 SMTP 和发信域名。不能说任意人可以注册或找回密码。
3. 没有短信商。手机登录不可用。
4. 没有 Kakao 应用。微信和 QQ 不是内置提供方。
5. 大陆网络能否访问 `*.supabase.co` 这次没有测。
