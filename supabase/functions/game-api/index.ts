import { createClient } from 'npm:@supabase/supabase-js@2';

const d = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const H = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,apikey,authorization',
  'Content-Type': 'application/json',
};
const J = (x: any, s = 200) => new Response(JSON.stringify(x), { status: s, headers: H });
const norm = (s: any) => String(s || '').toUpperCase().trim();
const pts = (g: number, y: number) => Math.abs(g - y) === 0 ? 2 : Math.abs(g - y) === 1 ? 1 : 0;

async function getPlayerAndRoom(playerToken: string) {
  const { data: p } = await d.from('players').select('*').eq('player_token', playerToken).single();
  if (!p) return null;
  const { data: r } = await d.from('rooms').select('*').eq('id', p.room_id).single();
  if (!r) return null;
  const { data: players } = await d.from('players').select('*').eq('room_id', p.room_id).order('joined_at');
  return { p, r, players: players || [] };
}

Deno.serve(async (q) => {
  if (q.method === 'OPTIONS') return new Response('ok', { headers: H });
  try {
    const b = await q.json();
    const a = b.action;

    if (a === 'health') return J({ ok: true, version: 13 });

    if (a === 'create') {
      const n = String(b.name || '').trim().slice(0, 24);
      const mode = ['solo', 'teams', 'couples'].includes(b.mode) ? b.mode : 'solo';
      const gameType = b.game_type === 'know' ? 'know' : 'classic';
      const expected = Number(b.expected_players) || 2;
      if (!n) return J({ error: 'name' }, 400);
      if (mode === 'couples' && ![4, 6, 8].includes(expected)) return J({ error: 'Для режима пар выбери 2, 3 или 4 пары' }, 400);
      if (mode === 'teams' && expected < 4) return J({ error: 'Для команд нужно минимум 4 игрока' }, 400);
      if (!Number.isInteger(expected) || expected < 2 || expected > 30) return J({ error: 'count' }, 400);
      const { data: rr, error: re } = await d.from('rooms').insert({ code: crypto.randomUUID().slice(0, 5).toUpperCase(), mode, level: b.level || 'light', total_rounds: Number(b.rounds) || 15, game_type: gameType, expected_players: expected }).select().single();
      if (re || !rr) return J({ error: 'room' }, 500);
      const { data: pp, error: pe } = await d.from('players').insert({ room_id: rr.id, name: n, team: mode === 'teams' ? 1 : null }).select().single();
      return pe || !pp ? J({ error: 'player' }, 500) : J({ room: rr, player: pp }, 201);
    }

    if (a === 'join') {
      const name = String(b.name || '').trim().slice(0, 24);
      if (!name) return J({ error: 'name' }, 400);
      const { data: rr } = await d.from('rooms').select('*').eq('code', norm(b.code)).single();
      if (!rr || rr.stage !== 'lobby') return J({ error: 'room unavailable' }, 409);
      const { data: ps } = await d.from('players').select('*').eq('room_id', rr.id).order('joined_at');
      const players = ps || [];
      if (rr.expected_players && players.length >= rr.expected_players) return J({ error: 'Комната уже заполнена' }, 409);
      let team = null;
      if (rr.mode === 'teams') {
        const one = players.filter((v: any) => v.team === 1).length;
        const two = players.filter((v: any) => v.team === 2).length;
        team = one <= two ? 1 : 2;
      }
      const { data: pp, error: pe } = await d.from('players').insert({ room_id: rr.id, name, team }).select().single();
      if (pe || !pp) return J({ error: 'join failed' }, 409);
      delete rr.host_token;
      return J({ room: rr, player: pp }, 201);
    }

    const ctx = await getPlayerAndRoom(b.player_token);
    if (!ctx) return J({ error: 'session' }, 401);
    const { p, r, players } = ctx;
    const pc = players.length;

    if (a === 'lobby_info') {
      const { data: links } = await d.from('pair_links').select('player_id,partner_id').eq('room_id', r.id);
      return J({ pairs: links || [] });
    }

    if (a === 'set_expected_players') {
      if (b.host_token !== r.host_token || r.stage !== 'lobby') return J({ error: 'host' }, 403);
      const e = Number(b.expected_players);
      if (r.mode === 'couples' && ![4, 6, 8].includes(e)) return J({ error: 'Выбери 2, 3 или 4 пары' }, 400);
      if (r.mode === 'teams' && e < 4) return J({ error: 'Минимум 4 игрока' }, 400);
      if (!Number.isInteger(e) || e < pc || e > 30) return J({ error: 'count' }, 400);
      const { error } = await d.from('rooms').update({ expected_players: e }).eq('id', r.id);
      return error ? J({ error: 'update count' }, 500) : J({ ok: true });
    }

    if (a === 'set_partner') {
      if (r.stage !== 'lobby' || r.mode !== 'couples') return J({ error: 'stage' }, 409);
      const t = players.find((x: any) => x.id === b.partner_id && x.id !== p.id);
      if (!t) return J({ error: 'partner' }, 400);
      const { data: used } = await d.from('pair_links').select('*').eq('room_id', r.id);
      const links = used || [];
      const theirs = links.find((x: any) => x.player_id === t.id);
      if (theirs && theirs.partner_id !== p.id) return J({ error: 'Этот игрок уже в паре' }, 409);
      await d.from('pair_links').delete().eq('room_id', r.id).or(`player_id.eq.${p.id},partner_id.eq.${p.id}`);
      const { error } = await d.from('pair_links').upsert([{ room_id: r.id, player_id: p.id, partner_id: t.id }, { room_id: r.id, player_id: t.id, partner_id: p.id }]);
      return error ? J({ error: 'partner' }, 409) : J({ ok: true });
    }

    if (a === 'vote') {
      if (r.stage !== 'vote' || typeof b.answer !== 'boolean') return J({ error: 'stage' }, 409);
      const { error: ve } = await d.from('answers').upsert({ room_id: r.id, round_no: r.current_round, player_id: p.id, answer: b.answer });
      if (ve) return J({ error: 'vote' }, 500);
      const n = (await d.from('answers').select('player_id', { count: 'exact', head: true }).eq('room_id', r.id).eq('round_no', r.current_round)).count || 0;
      if (n >= pc) {
        const nextStage = r.game_type === 'know' ? 'know_predict' : r.mode === 'couples' ? 'pair_predict' : r.mode === 'teams' ? 'team_bet' : 'bet';
        const { error } = await d.from('rooms').update({ stage: nextStage }).eq('id', r.id).eq('stage', 'vote');
        if (error) return J({ error: 'stage transition' }, 500);
      }
      return J({ ok: true, complete: n >= pc });
    }

    if (a === 'predict') {
      if (r.stage !== 'bet') return J({ error: 'stage' }, 409);
      const g = Number(b.guess);
      if (!Number.isInteger(g) || g < 0 || g > pc) return J({ error: 'guess' }, 400);
      const { error: pe } = await d.from('predictions').upsert({ room_id: r.id, round_no: r.current_round, player_id: p.id, guess: g });
      if (pe) return J({ error: 'prediction' }, 500);
      const n = (await d.from('predictions').select('player_id', { count: 'exact', head: true }).eq('room_id', r.id).eq('round_no', r.current_round)).count || 0;
      if (n >= pc) {
        const { data: an } = await d.from('answers').select('answer').eq('room_id', r.id).eq('round_no', r.current_round);
        const yes = (an || []).filter((x: any) => x.answer).length;
        const { data: pr } = await d.from('predictions').select('*').eq('room_id', r.id).eq('round_no', r.current_round);
        for (const x of pr || []) await d.from('predictions').update({ points: pts(x.guess, yes) }).eq('room_id', r.id).eq('round_no', r.current_round).eq('player_id', x.player_id);
        for (const pl of players) {
          const { data: all } = await d.from('predictions').select('points').eq('player_id', pl.id);
          await d.from('players').update({ score: (all || []).reduce((s: number, x: any) => s + (x.points || 0), 0) }).eq('id', pl.id);
        }
        await d.from('rooms').update({ yes_count: yes, stage: 'reveal' }).eq('id', r.id);
        return J({ ok: true, complete: true });
      }
      return J({ ok: true, complete: false });
    }

    if (a === 'team_predict') {
      if (r.mode !== 'teams' || r.stage !== 'team_bet') return J({ error: 'stage' }, 409);
      const tp = players.filter((x: any) => x.team === p.team);
      const cap = tp[(r.current_round - 1) % tp.length];
      if (cap?.id !== p.id) return J({ error: 'captain' }, 403);
      const g = Number(b.guess);
      if (!Number.isInteger(g) || g < 0 || g > pc) return J({ error: 'guess' }, 400);
      const { error: te } = await d.from('team_predictions').upsert({ room_id: r.id, round_no: r.current_round, team: p.team, player_id: p.id, guess: g });
      if (te) return J({ error: 'team prediction' }, 500);
      const n = (await d.from('team_predictions').select('team', { count: 'exact', head: true }).eq('room_id', r.id).eq('round_no', r.current_round)).count || 0;
      if (n >= 2) {
        const { data: an } = await d.from('answers').select('answer').eq('room_id', r.id).eq('round_no', r.current_round);
        const yes = (an || []).filter((x: any) => x.answer).length;
        const { data: pr } = await d.from('team_predictions').select('*').eq('room_id', r.id).eq('round_no', r.current_round);
        for (const x of pr || []) await d.from('team_predictions').update({ points: pts(x.guess, yes) }).eq('room_id', r.id).eq('round_no', r.current_round).eq('team', x.team);
        for (const pl of players) {
          const { data: rows } = await d.from('team_predictions').select('points').eq('room_id', r.id).eq('team', pl.team);
          await d.from('players').update({ score: (rows || []).reduce((s: number, x: any) => s + (x.points || 0), 0) }).eq('id', pl.id);
        }
        await d.from('rooms').update({ yes_count: yes, stage: 'reveal' }).eq('id', r.id);
      }
      return J({ ok: true, complete: n >= 2 });
    }

    if (a === 'pair_predict') {
      if (r.mode !== 'couples' || r.stage !== 'pair_predict' || typeof b.answer !== 'boolean') return J({ error: 'stage' }, 409);
      const { data: l } = await d.from('pair_links').select('partner_id').eq('room_id', r.id).eq('player_id', p.id).single();
      if (!l) return J({ error: 'partner' }, 409);
      const { error: ppe } = await d.from('pair_predictions').upsert({ room_id: r.id, round_no: r.current_round, player_id: p.id, target_id: l.partner_id, predicted_answer: b.answer });
      if (ppe) return J({ error: 'pair prediction' }, 500);
      const n = (await d.from('pair_predictions').select('player_id', { count: 'exact', head: true }).eq('room_id', r.id).eq('round_no', r.current_round)).count || 0;
      if (n >= pc) {
        const { data: an } = await d.from('answers').select('player_id,answer').eq('room_id', r.id).eq('round_no', r.current_round);
        const am = new Map((an || []).map((x: any) => [x.player_id, x.answer]));
        const { data: pr } = await d.from('pair_predictions').select('*').eq('room_id', r.id).eq('round_no', r.current_round);
        for (const x of pr || []) await d.from('pair_predictions').update({ points: am.get(x.target_id) === x.predicted_answer ? 1 : 0 }).eq('room_id', r.id).eq('round_no', r.current_round).eq('player_id', x.player_id);
        for (const pl of players) {
          const { data: rows } = await d.from('pair_predictions').select('points').eq('room_id', r.id).eq('player_id', pl.id);
          await d.from('players').update({ score: (rows || []).reduce((s: number, x: any) => s + (x.points || 0), 0) }).eq('id', pl.id);
        }
        await d.from('rooms').update({ yes_count: (an || []).filter((x: any) => x.answer).length, stage: 'reveal' }).eq('id', r.id);
      }
      return J({ ok: true, complete: n >= pc });
    }

    if (a === 'know_predict') {
      if (r.game_type !== 'know' || r.stage !== 'know_predict' || !Array.isArray(b.predictions)) return J({ error: 'stage' }, 409);
      const validTargets = new Set(players.filter((x: any) => x.id !== p.id).map((x: any) => x.id));
      if (b.predictions.length !== validTargets.size) return J({ error: 'predictions' }, 400);
      const rows = b.predictions.map((x: any) => ({ room_id: r.id, round_no: r.current_round, predictor_id: p.id, target_id: x.target_id, predicted_answer: x.answer }));
      if (rows.some((x: any) => !validTargets.has(x.target_id) || typeof x.predicted_answer !== 'boolean')) return J({ error: 'predictions' }, 400);
      const { error: ke } = await d.from('know_predictions').upsert(rows);
      if (ke) return J({ error: 'know prediction' }, 500);
      const expectedRows = pc * Math.max(0, pc - 1);
      const n = (await d.from('know_predictions').select('target_id', { count: 'exact', head: true }).eq('room_id', r.id).eq('round_no', r.current_round)).count || 0;
      if (expectedRows > 0 && n >= expectedRows) {
        const { data: answers } = await d.from('answers').select('player_id,answer').eq('room_id', r.id).eq('round_no', r.current_round);
        const answerMap = new Map((answers || []).map((x: any) => [x.player_id, x.answer]));
        const { data: preds } = await d.from('know_predictions').select('*').eq('room_id', r.id).eq('round_no', r.current_round);
        for (const pl of players) {
          const own = (preds || []).filter((x: any) => x.predictor_id === pl.id);
          const roundPoints = own.filter((x: any) => answerMap.get(x.target_id) === x.predicted_answer).length;
          const { data: priorRows } = await d.from('know_predictions').select('round_no,target_id,predicted_answer').eq('room_id', r.id).eq('predictor_id', pl.id).lt('round_no', r.current_round);
          let prior = 0;
          const rounds = [...new Set((priorRows || []).map((x: any) => x.round_no))];
          for (const rn of rounds) {
            const { data: aa } = await d.from('answers').select('player_id,answer').eq('room_id', r.id).eq('round_no', rn);
            const mm = new Map((aa || []).map((x: any) => [x.player_id, x.answer]));
            prior += (priorRows || []).filter((x: any) => x.round_no === rn && mm.get(x.target_id) === x.predicted_answer).length;
          }
          await d.from('players').update({ score: prior + roundPoints }).eq('id', pl.id);
        }
        await d.from('rooms').update({ stage: 'know_reveal' }).eq('id', r.id);
      }
      return J({ ok: true, complete: expectedRows > 0 && n >= expectedRows });
    }

    if (a === 'know_result') {
      if (r.game_type !== 'know' || r.stage !== 'know_reveal') return J({ error: 'stage' }, 409);
      const { data: preds } = await d.from('know_predictions').select('target_id,predicted_answer').eq('room_id', r.id).eq('round_no', r.current_round).eq('predictor_id', p.id);
      const { data: answers } = await d.from('answers').select('player_id,answer').eq('room_id', r.id).eq('round_no', r.current_round);
      const am = new Map((answers || []).map((x: any) => [x.player_id, x.answer]));
      const correct = (preds || []).filter((x: any) => am.get(x.target_id) === x.predicted_answer).length;
      return J({ correct, total: (preds || []).length });
    }

    if (a === 'confess') {
      if (!['reveal', 'know_reveal'].includes(r.stage)) return J({ error: 'stage' }, 409);
      const { data: ans } = await d.from('answers').select('answer').eq('room_id', r.id).eq('round_no', r.current_round).eq('player_id', p.id).single();
      if (!ans?.answer) return J({ error: 'only yes can confess' }, 409);
      const { error } = await d.from('confessions').upsert({ room_id: r.id, round_no: r.current_round, player_id: p.id, answer: true });
      return error ? J({ error: 'confess' }, 500) : J({ ok: true });
    }

    if (a === 'advance') {
      if (b.host_token !== r.host_token) return J({ error: 'host' }, 403);
      if (r.stage === 'lobby') {
        if (r.expected_players && pc !== r.expected_players) return J({ error: `Ждём игроков: ${pc} из ${r.expected_players}` }, 409);
        if (pc < 2) return J({ error: 'need 2 players' }, 409);
        if (r.mode === 'teams') {
          const one = players.filter((x: any) => x.team === 1).length;
          const two = players.filter((x: any) => x.team === 2).length;
          if (!one || !two || Math.abs(one - two) > 1) return J({ error: 'Команды должны быть примерно равными' }, 409);
        }
        if (r.mode === 'couples') {
          const c = (await d.from('pair_links').select('player_id', { count: 'exact', head: true }).eq('room_id', r.id)).count || 0;
          if (![4, 6, 8].includes(pc) || c !== pc) return J({ error: 'Соберите все пары перед стартом' }, 409);
        }
        const { error } = await d.from('rooms').update({ stage: 'vote', current_round: 1, question_text: b.question || '' }).eq('id', r.id);
        return error ? J({ error: 'start' }, 500) : J({ ok: true });
      }
      if (['reveal', 'know_reveal'].includes(r.stage)) {
        const patch = r.current_round >= r.total_rounds ? { stage: 'finished' } : { stage: 'vote', current_round: r.current_round + 1, question_text: b.question || '', yes_count: null };
        const { error } = await d.from('rooms').update(patch).eq('id', r.id);
        return error ? J({ error: 'advance' }, 500) : J({ ok: true });
      }
      return J({ error: 'stage' }, 409);
    }

    if (a === 'restart') {
      if (b.host_token !== r.host_token) return J({ error: 'host' }, 403);
      for (const t of ['know_predictions', 'pair_predictions', 'team_predictions', 'confessions', 'predictions', 'answers']) await d.from(t).delete().eq('room_id', r.id);
      await d.from('players').update({ score: 0 }).eq('room_id', r.id);
      const { error } = await d.from('rooms').update({ stage: 'lobby', current_round: 0, question_text: null, yes_count: null }).eq('id', r.id);
      return error ? J({ error: 'restart' }, 500) : J({ ok: true });
    }

    return J({ error: 'action' }, 400);
  } catch (e) {
    console.error(e);
    return J({ error: 'server' }, 500);
  }
});