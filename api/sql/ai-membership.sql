-- AI tutor membership and AI-quota schema (repo copy, apply manually).
--
-- HONEST GAP: purchase and checkout are NOT implemented. There is no payment
-- vendor, no price, and no endpoint that grants membership. This file only
-- defines storage and the server-side RPCs used by /api/chat.
--
-- Do NOT seed member rows. Membership and quota must be granted by an operator
-- after a real purchase system exists.
--
-- AI quota is NOT the site's "learning energy". No learning-energy field is
-- read or spent by the tutor API. The two balances must stay separate.
--
-- The server calls these RPCs with the Supabase service role. End users must
-- not be able to update their own membership or quota.

create table if not exists public.ai_memberships (
  user_id uuid primary key references auth.users (id) on delete cascade,
  is_member boolean not null default false,
  ai_quota_remaining integer not null default 0 check (ai_quota_remaining >= 0),
  updated_at timestamptz not null default now()
);

alter table public.ai_memberships enable row level security;

-- No RLS policies are created for anon/authenticated on purpose. Default deny
-- means end users cannot read or update quota from the browser. The service
-- role bypasses RLS.
revoke all on table public.ai_memberships from public, anon, authenticated;
grant all on table public.ai_memberships to service_role;

-- Atomically take one unit. Returns the new remaining balance, or NULL when
-- the user is not a member or has no quota left.
create or replace function public.consume_ai_quota(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_remaining integer;
begin
  if p_user_id is null then
    return null;
  end if;

  update public.ai_memberships
     set ai_quota_remaining = ai_quota_remaining - 1,
         updated_at = now()
   where user_id = p_user_id
     and is_member = true
     and ai_quota_remaining > 0
  returning ai_quota_remaining into v_remaining;

  return v_remaining;
end;
$$;

-- Refund one reserved unit when the LLM call fails before a reply exists.
-- This is only callable with the service role.
create or replace function public.refund_ai_quota(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_remaining integer;
begin
  if p_user_id is null then
    return null;
  end if;

  update public.ai_memberships
     set ai_quota_remaining = ai_quota_remaining + 1,
         updated_at = now()
   where user_id = p_user_id
  returning ai_quota_remaining into v_remaining;

  return v_remaining;
end;
$$;

revoke all on function public.consume_ai_quota(uuid) from public, anon, authenticated;
revoke all on function public.refund_ai_quota(uuid) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid) to service_role;
grant execute on function public.refund_ai_quota(uuid) to service_role;
