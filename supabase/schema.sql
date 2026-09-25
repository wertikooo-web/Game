-- CHESNO realtime backend. Apply in Supabase SQL editor.
create extension if not exists pgcrypto;

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null check (char_length(code) between 4 and 8),
  host_token uuid not null default gen_random_uuid(),
  mode text not null default 'solo' check (mode in ('solo','teams','couples')),
  level text not null default 'mix',
  total_rounds int not null default 15 check (total_rounds between 5 and 50),
  current_round int not null default 0,
  stage text not null default 'lobby' check (stage in ('lobby','vote','bet','reveal','finished')),
  question_text text,
  yes_count int,
  created_at timestamptz not null default now()
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_token uuid not null default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 24),
  team int,
  score int not null default 0,
  joined_at timestamptz not null default now(),
  unique(room_id,name)
);

create table public.answers (
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_no int not null,
  player_id uuid not null references public.players(id) on delete cascade,
  answer boolean not null,
  created_at timestamptz not null default now(),
  primary key(room_id,round_no,player_id)
);

create table public.predictions (
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_no int not null,
  player_id uuid not null references public.players(id) on delete cascade,
  guess int not null check (guess >= 0),
  points int,
  created_at timestamptz not null default now(),
  primary key(room_id,round_no,player_id)
);

create table public.confessions (
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_no int not null,
  player_id uuid not null references public.players(id) on delete cascade,
  answer boolean not null,
  created_at timestamptz not null default now(),
  primary key(room_id,round_no,player_id)
);

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.answers enable row level security;
alter table public.predictions enable row level security;
alter table public.confessions enable row level security;

-- Public room state contains aggregates only. Raw answers deliberately have no SELECT policy.
create policy "read room state" on public.rooms for select using (true);
create policy "read players" on public.players for select using (true);
create policy "read predictions after reveal" on public.predictions for select using (
  exists(select 1 from public.rooms r where r.id=room_id and r.stage in ('reveal','finished'))
);
create policy "read confessions" on public.confessions for select using (true);

alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.players;
alter publication supabase_realtime add table public.confessions;

-- Mutations should go through Edge Functions using service role. Never expose service_role in browser.
create index players_room_idx on public.players(room_id);
create index answers_round_idx on public.answers(room_id,round_no);
create index predictions_round_idx on public.predictions(room_id,round_no);
