alter table public.rooms drop constraint if exists rooms_stage_check;
alter table public.rooms add constraint rooms_stage_check check (
  stage in (
    'lobby','vote','bet','team_bet','pair_predict','know_predict',
    'revealing','reveal','know_reveal','finished'
  )
);

alter table public.pair_links enable row level security;

create or replace view public.room_public as
select
  id, code, mode, level, total_rounds, current_round, stage,
  question_text, yes_count, created_at, game_type, expected_players
from public.rooms;
