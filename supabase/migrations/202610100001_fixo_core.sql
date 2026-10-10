create extension if not exists pgcrypto;
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 email text, display_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.portfolios (
 id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users(id) on delete cascade,
 cash_balance numeric(18,2) not null default 100000.00 check(cash_balance >= 0),
 currency text not null default 'INR' check(currency='INR'), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.positions (
 id uuid primary key default gen_random_uuid(), portfolio_id uuid not null references public.portfolios(id) on delete cascade,
 symbol text not null, quantity numeric(20,6) not null check(quantity>0), average_price numeric(18,4) not null check(average_price>=0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(portfolio_id,symbol)
);
create table if not exists public.market_quotes (
 symbol text primary key, company text not null, price numeric(18,4) not null check(price>0), change_percent numeric(10,4),
 currency text not null default 'INR', exchange text, source text not null default 'yahoo-finance', updated_at timestamptz not null default now()
);
create table if not exists public.paper_orders (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 symbol text not null, side text not null check(side in ('buy','sell')), quantity numeric(20,6) not null check(quantity>0),
 price numeric(18,4) not null check(price>0), notional numeric(20,2) not null check(notional>0),
 status text not null default 'filled' check(status in ('filled','rejected')), created_at timestamptz not null default now()
);
create table if not exists public.watchlist_items (
 id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 symbol text not null, created_at timestamptz not null default now(), unique(user_id,symbol)
);
create index if not exists positions_portfolio_idx on public.positions(portfolio_id);
create index if not exists paper_orders_user_created_idx on public.paper_orders(user_id,created_at desc);
create index if not exists watchlist_user_idx on public.watchlist_items(user_id);

alter table public.profiles enable row level security;
alter table public.portfolios enable row level security;
alter table public.positions enable row level security;
alter table public.market_quotes enable row level security;
alter table public.paper_orders enable row level security;
alter table public.watchlist_items enable row level security;

drop policy if exists "profiles read own" on public.profiles;
create policy "profiles read own" on public.profiles for select to authenticated using ((select auth.uid())=id);
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);
drop policy if exists "portfolios read own" on public.portfolios;
create policy "portfolios read own" on public.portfolios for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "positions read own" on public.positions;
create policy "positions read own" on public.positions for select to authenticated using (exists(select 1 from public.portfolios p where p.id=portfolio_id and p.user_id=(select auth.uid())));
drop policy if exists "orders read own" on public.paper_orders;
create policy "orders read own" on public.paper_orders for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "watchlist read own" on public.watchlist_items;
create policy "watchlist read own" on public.watchlist_items for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "watchlist insert own" on public.watchlist_items;
create policy "watchlist insert own" on public.watchlist_items for insert to authenticated with check ((select auth.uid())=user_id);
drop policy if exists "watchlist delete own" on public.watchlist_items;
create policy "watchlist delete own" on public.watchlist_items for delete to authenticated using ((select auth.uid())=user_id);
drop policy if exists "quotes readable" on public.market_quotes;
create policy "quotes readable" on public.market_quotes for select to anon,authenticated using(true);

grant select,update on public.profiles to authenticated;
grant select on public.portfolios,public.positions,public.paper_orders to authenticated;
grant select,insert,delete on public.watchlist_items to authenticated;
grant select on public.market_quotes to anon,authenticated;
grant all on public.profiles,public.portfolios,public.positions,public.paper_orders,public.market_quotes,public.watchlist_items to service_role;

create or replace function public.handle_new_fixo_user()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 insert into public.profiles(id,email,display_name) values(new.id,new.email,coalesce(new.raw_user_meta_data->>'display_name',split_part(coalesce(new.email,''),'@',1))) on conflict(id) do nothing;
 insert into public.portfolios(user_id,cash_balance) values(new.id,100000.00) on conflict(user_id) do nothing;
 return new;
end;
$$;
drop trigger if exists on_auth_user_created_fixo on auth.users;
create trigger on_auth_user_created_fixo after insert on auth.users for each row execute function public.handle_new_fixo_user();

create or replace function public.place_paper_order(p_symbol text,p_side text,p_quantity numeric)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp
as $$
declare
 v_user_id uuid:=auth.uid(); v_portfolio public.portfolios%rowtype; v_quote public.market_quotes%rowtype;
 v_position public.positions%rowtype; v_notional numeric(20,2); v_new_qty numeric(20,6); v_new_avg numeric(18,4); v_order public.paper_orders%rowtype;
begin
 if v_user_id is null then raise exception 'Authentication required'; end if;
 if upper(trim(p_symbol)) !~ '^[A-Z0-9^._-]{1,20}$' then raise exception 'Invalid symbol'; end if;
 if lower(p_side) not in ('buy','sell') then raise exception 'Side must be buy or sell'; end if;
 if p_quantity is null or p_quantity<=0 or p_quantity>1000000 then raise exception 'Quantity must be between 0 and 1000000'; end if;
 select * into v_portfolio from public.portfolios where user_id=v_user_id for update;
 if not found then raise exception 'Paper portfolio not found'; end if;
 select * into v_quote from public.market_quotes where symbol=upper(trim(p_symbol));
 if not found or v_quote.price<=0 or v_quote.updated_at<now()-interval '30 minutes' then raise exception 'No fresh quote is available. Refresh market data and retry.'; end if;
 v_notional:=round(v_quote.price*p_quantity,2);
 select * into v_position from public.positions where portfolio_id=v_portfolio.id and symbol=v_quote.symbol for update;
 if lower(p_side)='buy' then
  if v_portfolio.cash_balance<v_notional then raise exception 'Insufficient virtual cash'; end if;
  update public.portfolios set cash_balance=cash_balance-v_notional,updated_at=now() where id=v_portfolio.id;
  if v_position.id is not null then
   v_new_qty:=v_position.quantity+p_quantity;
   v_new_avg:=round(((v_position.quantity*v_position.average_price)+(p_quantity*v_quote.price))/v_new_qty,4);
   update public.positions set quantity=v_new_qty,average_price=v_new_avg,updated_at=now() where id=v_position.id;
  else
   insert into public.positions(portfolio_id,symbol,quantity,average_price) values(v_portfolio.id,v_quote.symbol,p_quantity,v_quote.price);
  end if;
 else
  if v_position.id is null or v_position.quantity<p_quantity then raise exception 'Insufficient position quantity to sell'; end if;
  update public.portfolios set cash_balance=cash_balance+v_notional,updated_at=now() where id=v_portfolio.id;
  if v_position.quantity=p_quantity then delete from public.positions where id=v_position.id;
  else update public.positions set quantity=quantity-p_quantity,updated_at=now() where id=v_position.id; end if;
 end if;
 insert into public.paper_orders(user_id,symbol,side,quantity,price,notional,status) values(v_user_id,v_quote.symbol,lower(p_side),p_quantity,v_quote.price,v_notional,'filled') returning * into v_order;
 return jsonb_build_object('order_id',v_order.id,'symbol',v_order.symbol,'side',v_order.side,'quantity',v_order.quantity,'price',v_order.price,'notional',v_order.notional,'cash_balance',(select cash_balance from public.portfolios where id=v_portfolio.id),'status',v_order.status,'created_at',v_order.created_at);
end;
$$;
revoke all on function public.place_paper_order(text,text,numeric) from public,anon;
grant execute on function public.place_paper_order(text,text,numeric) to authenticated;
