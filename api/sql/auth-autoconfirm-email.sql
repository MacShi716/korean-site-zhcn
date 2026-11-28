-- Live email auto-confirm trigger (repo copy, already applied manually).
--
-- Why this exists
--   The Auth project 韩语学习网站 (ref fehowefhgzjmdlpaoqig) has the email
--   provider on, but custom SMTP is NOT configured and customSmtpConfigured is
--   false. The dashboard "Confirm email" switch is still ON (the public Auth
--   settings endpoint reports mailer_autoconfirm = false), so signUp would
--   normally return no session and wait for a confirmation mail that ordinary
--   visitors cannot receive. The Management API was not available to flip that
--   dashboard switch.
--
--   This trigger is the live path: it stamps email_confirmed_at on the new
--   auth.users row before insert, so the Auth API returns a session
--   immediately. Verified against the live Auth API: signUp returns a session
--   and signInWithPassword works for that user. Test users were deleted.
--
-- Removal
--   When custom SMTP is configured AND the dashboard "Confirm email" switch is
--   turned back on (mailer_autoconfirm becomes true), remove this trigger:
--
--     drop trigger if exists autoconfirm_email_user on auth.users;
--     drop function if exists internal_auth.autoconfirm_email_user();
--     drop schema if exists internal_auth;
--
-- Scope
--   internal_auth is not granted to anon or authenticated. The function is
--   SECURITY DEFINER and only touches the NEW row; it does not read or write
--   other users. It never makes password reset mail deliverable: that still
--   needs custom SMTP.

create schema if not exists internal_auth;

revoke all on schema internal_auth from public;
revoke all on schema internal_auth from anon, authenticated;

create or replace function internal_auth.autoconfirm_email_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null
     and new.email <> ''
     and new.email_confirmed_at is null then
    new.email_confirmed_at := now();
  end if;
  return new;
end;
$$;

revoke all on function internal_auth.autoconfirm_email_user() from public;
revoke all on function internal_auth.autoconfirm_email_user() from anon, authenticated;
grant usage on schema internal_auth to postgres, supabase_admin, supabase_auth_admin;
grant execute on function internal_auth.autoconfirm_email_user() to postgres, supabase_admin, supabase_auth_admin;

drop trigger if exists autoconfirm_email_user on auth.users;

create trigger autoconfirm_email_user
before insert on auth.users
for each row
execute function internal_auth.autoconfirm_email_user();

comment on schema internal_auth is
  'Private helper schema for Auth triggers. Not exposed to anon or authenticated.';

comment on function internal_auth.autoconfirm_email_user() is
  'Live path while custom SMTP is unavailable: mark a new email user confirmed so signUp can return a session. Remove when SMTP is set up and Confirm email is back on.';

comment on trigger autoconfirm_email_user on auth.users is
  'Auto-confirms new email users before insert. Required only while custom SMTP is not configured and mailer_autoconfirm is false.';
