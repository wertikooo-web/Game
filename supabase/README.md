# Realtime backend contract

The browser subscribes only to safe aggregate state: `rooms`, `players`, `confessions`. Raw `answers` are write-only from the public client's perspective and are aggregated by trusted server code.

## Edge functions to deploy

`create-room`: creates a room and host player, returns room code, room id, host token and player token.

`join-room`: accepts room code + display name, returns player id/token and current public room state.

`vote`: accepts player token + boolean answer. Upserts one answer for current round. Returns only submitted status and total submitted count, never individual answers.

`predict`: accepts player token + integer guess. Upserts one prediction for current round.

`advance`: host-only. Moves vote -> bet when all active players voted; bet -> reveal when all predicted. On reveal it counts YES server-side, writes only `rooms.yes_count`, calculates 3/2/1/0 points, updates player scores, and broadcasts safe room state. From reveal -> next round or finished.

`confess`: player may voluntarily expose only their own answer for the current revealed round.

## Security invariants

1. Never expose `service_role` to browser code.
2. Never grant SELECT on `answers`.
3. Never include another player's `player_token` in public realtime payloads.
4. Host controls stage changes with `host_token`.
5. Server derives room/player from tokens and ignores client-supplied score, yes_count or points.
6. Rate-limit joins and mutations before public launch.

## Frontend environment

The browser only needs `SUPABASE_URL` and the public anon/publishable key. These are safe to ship when RLS and server mutations are configured correctly.
