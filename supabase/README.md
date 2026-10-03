# Realtime backend contract

Production uses one Supabase Edge Function: `game-api` (v13 as of 2026-10-03).

The browser reads only public room/player/confession views. Raw anonymous answers stay server-side. Mutations go through `game-api` with player/host tokens.

## Supported game flows

### Classic solo
`lobby -> vote -> bet -> reveal -> next round / finished`

Players answer YES/NO anonymously, then predict the total YES count. Scoring: exact = +2, off by 1 = +1, otherwise 0.

### Classic teams
`lobby -> vote -> team_bet -> reveal -> next round / finished`

Teams are balanced on join. A rotating captain submits the team prediction.

### Classic couples
`lobby -> vote -> pair_predict -> reveal -> next round / finished`

Every player is linked to one partner and predicts that partner's YES/NO answer.

### Who Knows Whom
`lobby -> vote -> know_predict -> know_reveal -> next round / finished`

Each player answers privately, then predicts every other player's YES/NO answer. Each correct prediction is worth 1 point.

## Main API actions

`create`, `join`, `lobby_info`, `set_expected_players`, `set_partner`, `vote`, `predict`, `team_predict`, `pair_predict`, `know_predict`, `know_result`, `confess`, `advance`, `restart`, `health`.

## Security invariants

1. Never expose `service_role` in browser code.
2. Raw `answers` and private prediction tables are protected by RLS.
3. Public views never expose `host_token` or `player_token`.
4. Host-only mutations validate `host_token` server-side.
5. Scores, answer counts and stage transitions are derived server-side.
6. `pair_links` has RLS enabled; pair data is returned through `lobby_info`.
7. Before a broad public launch, add abuse/rate limiting for room creation and joins.

## Production migration

The current multiplayer stage constraint and public room view are documented in `migrations/20261003_stabilize_multiplayer.sql`.
