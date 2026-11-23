/** User-facing copy. Auth error messages from the server are not shown raw. */
export const COPY = {
  missing_url: "还没有 Supabase 项目 URL。真实登录已停住。",
  missing_key: "还没有可公开的 publishable key。真实登录已停住。",
  bad_url: "项目 URL 必须是 https://<项目>.supabase.co。这次请求已拒绝。",
  secret_key_rejected: "这个密钥不能放进网页。secret 和 service_role 只能留在服务端，请求已拒绝。",
  unrecognized_key: "这不是可公开的 publishable key，也不是旧版 anon key。请求已拒绝。",
  builtin_admin_only: "内置发信仅限管理员测试邮箱，公网注册/找回密码需先配置自有域名与自定义 SMTP。这次可以交给认证服务做管理员邮箱联调，确认完成前没有登录。",
  reset_builtin_admin: "内置发信仅限管理员测试邮箱，公网注册/找回密码需先配置自有域名与自定义 SMTP。如果这个管理员邮箱可以收信，重置信会发出。服务不会说明账号是否存在。",
  signed_in_autoconfirm: "已登录。邮箱确认当前是关闭的，所以这次没有等待确认信。找回密码和邮箱验证仍要先配置自有域名与自定义 SMTP。学习记录没有上传。",
  reset_pending_smtp: "找回密码和邮箱验证仍要先配置自有域名与自定义 SMTP。请求已交给认证服务，但现在不能把公网邮箱当成已经能收信。服务不会说明账号是否存在。",
  sms_provider_not_configured: "手机验证码现在不可用。项目没有短信服务商（Twilio、MessageBird、Vonage 或 TextLocal），所以不会发短信，也不会登录。",
  demo_code_rejected: "000000 是旧演示码。它不会登录成功，也不会被当成短信验证码。",
  password_required: "请填写密码。没有登录成功。",
  password_too_short: "密码至少 8 位。没有提交。",
  password_too_long: "密码超过 72 字节，认证服务无法安全保存。没有提交。",
  email_invalid: "请填写有效邮箱。没有提交。",
  phone_invalid: "这个区号下的手机号格式不对。没有提交。",
  recovery_session_missing: "还没有密码重置会话。请从重置邮件里的链接进入后再设置新密码。没有修改密码。",
  auth_client_missing: "公开配置还没变成可用的 Auth 客户端。没有登录成功。",
  invalid_callback: "这个邮件链接缺少可用的 code 或 token_hash。没有登录成功。",
  implicit_token_rejected: "地址栏里出现了 access_token。这份草稿使用 PKCE，不会把地址栏里的令牌存成登录。请重新从邮件打开，或在同一浏览器里重新请求。",
  network_error: "没有连上认证服务，暂时不能确认登录状态。没有把它当成已登录。",
  auth_request_failed: "认证服务没有完成这次请求。没有登录成功。",
  confirmation_required: "请求已交给认证服务。如果这个邮箱可以接收确认信，信会发出。确认完成前，这里还没有登录。服务不会说明这个邮箱是否已经注册。",
  reset_requested: "请求已交给认证服务。如果这个邮箱可以接收邮件，重置信会发出。服务不会说明账号是否存在。",
  signed_in: "已登录。学习记录、对话和健康相关数据没有上传。",
  signed_out: "已退出这个浏览器上的登录。其他设备上的会话不会被这次操作取消。",
  guest: "现在是游客。可以返回继续学习。这里没有读取或上传本机练习记录。",
  password_updated: "密码已更新。学习数据仍然没有上传。",
  recovery_ready: "重置链接已确认。请设置一个新密码。设置完成前，不要把这次会话当成日常登录。",
  no_callback: "地址栏里没有待兑换的邮件链接。",
  email_not_confirmed: "这个邮箱还没完成确认，所以没有登录。",
  invalid_credentials: "邮箱或密码不正确。没有登录成功。",
  email_address_not_authorized: "认证服务拒绝发信：项目还在用默认邮件，这个地址不是组织成员。没有登录。给公众发信需要自定义 SMTP 和你自己的发信域名。",
  over_email_send_rate_limit: "邮件发送太频繁。默认邮件服务当前大约每小时 2 封，而且这个限额会变。请稍后再试。没有登录成功。",
  over_request_rate_limit: "请求太频繁。请稍后再试。没有登录成功。",
  over_sms_send_rate_limit: "短信发送太频繁。没有登录成功。",
  weak_password: "密码不符合项目要求。没有登录成功。",
  same_password: "新密码不能和当前密码相同。没有修改。",
  signup_disabled: "项目关闭了注册。没有登录成功。",
  email_provider_disabled: "项目关闭了邮箱密码登录。没有登录成功。",
  user_banned: "这个账号已被暂停。没有登录成功。",
  otp_expired: "链接或验证码已过期。请重新请求。没有登录成功。",
  flow_state_expired: "登录链接已过期。请重新请求。没有登录成功。",
  flow_state_not_found: "登录链接已经用过或已失效。请重新请求。没有登录成功。",
  bad_code_verifier: "这次链接和发起请求的浏览器对不上。PKCE 需要在同一个浏览器里打开邮件。没有登录成功。",
  provider_disabled: "这个登录方式在项目里没有启用。没有登录成功。",
  oauth_provider_not_supported: "认证服务不支持这个登录提供方。没有登录成功。",
  email_exists: "这个邮箱已经注册过。这次没有建立新的登录。如果这是你的邮箱，请直接登录。",
  user_already_exists: "这个邮箱已经注册过。这次没有建立新的登录。如果这是你的邮箱，请直接登录。",
  session_expired: "登录已过期。请重新登录。",
  session_not_found: "服务器上已经没有这次登录。请重新登录。",
  refresh_token_not_found: "服务器上已经没有这次登录。请重新登录。",
  refresh_token_already_used: "登录刷新已失效。请重新登录。",
};

export function userMessage(code) {
  return COPY[code] || COPY.auth_request_failed;
}

export function socialBlockedMessage(provider) {
  if (provider === "wechat") {
    return "微信登录暂未启用，没有外部应用凭据。没有跳转，没有登录。";
  }
  if (provider === "qq") {
    return "QQ 登录暂未启用，没有外部应用凭据。没有跳转，没有登录。";
  }
  if (provider === "kakao") {
    return "Kakao 登录暂未启用，还没有应用凭据。没有跳转，没有登录。";
  }
  return "这个登录方式还没有配置。没有跳转，没有登录。";
}
