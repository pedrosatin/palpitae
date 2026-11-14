/// <reference types="node" />
/**
 * Contrato byte a byte de `GET /groups` com vários grupos divididos entre
 * múltiplas competições. Os casos cobrem ligas, copas, pênaltis, rodadas que
 * ficaram para trás, placares ao vivo, pódio, banidos, excluídos e competições
 * piloto.
 */
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import { limitD1Binds } from '../testing/d1BindLimit'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.useRealTimers()
})

const NOW = '2026-06-15T12:00:00Z'
const JWT_SECRET = 'test-groups-list-contract'

function seedContractFixture() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)

  sqlite.exec(`
    INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
      ('alice', 'alice@example.com', 'google', 'g-alice', 'Alice'),
      ('bob', 'bob@example.com', 'google', 'g-bob', 'Bob'),
      ('carol', 'carol@example.com', 'google', 'g-carol', 'Carol'),
      ('banned', 'banned@example.com', 'google', 'g-banned', 'Banido');

    INSERT INTO profiles (user_id, nickname) VALUES
      ('alice', 'Alice'),
      ('bob', 'Beto'),
      ('carol', 'Carol'),
      ('banned', 'Banido');

    DELETE FROM competitions;

    INSERT INTO competitions (
      id, name, slug, external_id, provider, season, status, type, penalty_phases, visibility
    ) VALUES
      ('comp-liga', 'Brasileirão 2026', 'brasileirao-2026', 'BSA', 'football-data', '2026', 'ongoing', 'league', '[]', 'public'),
      ('comp-copa', 'Copa Nacional', 'copa-nacional-2026', 'bra.copa', 'espn', '2026', 'ongoing', 'cup', '["QUARTER_FINALS"]', 'public'),
      ('comp-entre-fases', 'Copa Entre Fases', 'copa-entre-fases', 'bra.entrefases', 'espn', '2026', 'ongoing', 'cup', '["FINAL"]', 'public'),
      ('comp-liga-fim', 'Liga Encerrada', 'liga-encerrada-2026', 'PL', 'football-data', '2026', 'upcoming', 'league', '[]', 'public'),
      ('comp-copa-fim', 'Copa Encerrada', 'copa-encerrada-2025', 'CL', 'football-data', '2025', 'finished', 'cup', '["FINAL"]', 'public'),
      ('comp-vazia', 'Sem Jogos', 'sem-jogos-2026', NULL, NULL, '2026', 'upcoming', 'league', '[]', 'public'),
      ('comp-piloto', 'Liga Piloto', 'liga-piloto-2026', 'bra.piloto', 'espn', '2026', 'ongoing', 'league', '[]', 'pilot');

    INSERT INTO teams (id, name, short_name, slug) VALUES
      ('fla', 'Flamengo', 'FLA', 'flamengo'),
      ('pal', 'Palmeiras', 'PAL', 'palmeiras'),
      ('cor', 'Corinthians', 'COR', 'corinthians'),
      ('sao', 'São Paulo', 'SAO', 'sao-paulo');

    INSERT INTO matches (
      id, competition_id, external_id, provider,
      home_team_id, away_team_id, start_time, status, round, phase, leg, postponed, locked_at, home_score, away_score
    ) VALUES
      -- comp-liga: rodada 1 ficou para trás com 1 remarcado aberto; rodada 2 é a padrão; 1 jogo ao vivo
      ('l-r1-1', 'comp-liga', 'l-1', 'football-data', 'fla', 'pal', '2026-06-01T19:00:00Z', 'finished', '1', NULL, NULL, 0, '2026-06-01T19:00:00Z', 2, 1),
      ('l-r1-2', 'comp-liga', 'l-2', 'football-data', 'cor', 'sao', '2026-06-02T19:00:00Z', 'finished', '1', NULL, NULL, 0, '2026-06-02T19:00:00Z', 0, 0),
      ('l-r1-3', 'comp-liga', 'l-2b', 'football-data', 'fla', 'sao', '2026-06-03T19:00:00Z', 'finished', '1', NULL, NULL, 0, '2026-06-03T19:00:00Z', 1, 0),
      ('l-r1-rem', 'comp-liga', 'l-3', 'football-data', 'sao', 'pal', '2026-06-18T19:00:00Z', 'scheduled', '1', NULL, NULL, 0, NULL, NULL, NULL),
      ('l-live', 'comp-liga', 'l-4', 'football-data', 'pal', 'cor', '2026-06-15T11:00:00Z', 'scheduled', '1', NULL, NULL, 0, NULL, NULL, NULL),
      ('l-r2-1', 'comp-liga', 'l-5', 'football-data', 'fla', 'cor', '2026-06-20T19:00:00Z', 'scheduled', '2', NULL, NULL, 0, NULL, NULL, NULL),
      ('l-r2-2', 'comp-liga', 'l-6', 'football-data', 'pal', 'sao', '2026-06-22T19:00:00Z', 'scheduled', '2', NULL, NULL, 0, NULL, NULL, NULL),
      ('l-r2-adi', 'comp-liga', 'l-7', 'football-data', 'cor', 'fla', '2026-06-25T19:00:00Z', 'scheduled', '2', NULL, NULL, 1, NULL, NULL, NULL),
      ('l-r2-lock', 'comp-liga', 'l-8', 'football-data', 'sao', 'fla', '2026-06-26T19:00:00Z', 'scheduled', '2', NULL, NULL, 0, '2026-06-15T10:00:00Z', NULL, NULL),

      -- comp-copa: quartas com ida e volta em que falta pênalti para quem empatar agregado
      ('c-q1-ida', 'comp-copa', 'c-1', 'espn', 'fla', 'pal', '2026-06-10T19:00:00Z', 'finished', 'QUARTER_FINALS', 'QUARTER_FINALS', 1, 0, '2026-06-10T19:00:00Z', 1, 0),
      ('c-q1-volta', 'comp-copa', 'c-2', 'espn', 'pal', 'fla', '2026-06-17T19:00:00Z', 'scheduled', 'QUARTER_FINALS', 'QUARTER_FINALS', 2, 0, NULL, NULL, NULL),
      ('c-q2-unico', 'comp-copa', 'c-3', 'espn', 'cor', 'sao', '2026-06-21T19:00:00Z', 'scheduled', 'QUARTER_FINALS', 'QUARTER_FINALS', NULL, 0, NULL, NULL, NULL),

      -- comp-entre-fases: todos os jogos encerrados sem final gravada (segue ongoing)
      ('ef-1', 'comp-entre-fases', 'ef-1', 'espn', 'fla', 'cor', '2026-06-05T19:00:00Z', 'finished', 'QUARTER_FINALS', 'QUARTER_FINALS', NULL, 0, '2026-06-05T19:00:00Z', 2, 0),

      -- comp-liga-fim: status 'upcoming' na tabela, mas todos os jogos encerrados -> 'finished'
      ('lf-1', 'comp-liga-fim', 'lf-1', 'football-data', 'fla', 'pal', '2026-05-20T19:00:00Z', 'finished', '1', NULL, NULL, 0, '2026-05-20T19:00:00Z', 1, 1),

      -- comp-copa-fim: status 'finished' na tabela e final encerrada
      ('cf-1', 'comp-copa-fim', 'cf-1', 'football-data', 'pal', 'sao', '2025-05-30T19:00:00Z', 'finished', 'FINAL', 'FINAL', NULL, 0, '2025-05-30T19:00:00Z', 3, 1),

      -- comp-piloto: aberta só para usuário piloto
      ('p-1', 'comp-piloto', 'p-1', 'espn', 'cor', 'pal', '2026-06-19T19:00:00Z', 'scheduled', '1', NULL, NULL, 0, NULL, NULL, NULL);

    INSERT INTO groups (
      id, name, competition_id, owner_user_id, invite_code, points_exact, created_at, deleted_at
    ) VALUES
      ('g-liga-1', 'Liga Um', 'comp-liga', 'alice', 'LIGA-0001', 3, '2026-06-01T10:00:00Z', NULL),
      ('g-liga-2', 'Liga Dois', 'comp-liga', 'bob', 'LIGA-0002', 5, '2026-06-02T10:00:00Z', NULL),
      ('g-liga-3', 'Liga Três', 'comp-liga', 'alice', 'LIGA-0003', 0, '2026-06-03T10:00:00Z', NULL),
      ('g-copa-1', 'Copa Falta Pênalti', 'comp-copa', 'alice', 'COPA-0001', 3, '2026-06-04T10:00:00Z', NULL),
      ('g-copa-2', 'Copa Pênalti Preenchido', 'comp-copa', 'bob', 'COPA-0002', 3, '2026-06-05T10:00:00Z', NULL),
      ('g-entre-fases', 'Entre Fases', 'comp-entre-fases', 'alice', 'EFAS-0001', 3, '2026-06-06T10:00:00Z', NULL),
      ('g-liga-fim', 'Liga Fim', 'comp-liga-fim', 'bob', 'LFIM-0001', 3, '2026-06-07T10:00:00Z', NULL),
      ('g-copa-fim', 'Copa Fim', 'comp-copa-fim', 'alice', 'CFIM-0001', 3, '2026-06-08T10:00:00Z', NULL),
      ('g-vazia', 'Grupo Vazio', 'comp-vazia', 'alice', 'VAZI-0001', 3, '2026-06-09T10:00:00Z', NULL),
      ('g-piloto', 'Grupo Piloto', 'comp-piloto', 'alice', 'PILO-0001', 3, '2026-06-10T10:00:00Z', NULL),
      ('g-deletado', 'Grupo Excluído', 'comp-liga', 'alice', 'DELE-0001', 3, '2026-06-11T10:00:00Z', '2026-06-12T00:00:00Z'),
      ('g-banido', 'Grupo Banido', 'comp-liga', 'bob', 'BANI-0001', 3, '2026-06-12T10:00:00Z', NULL);

    INSERT INTO group_members (id, group_id, user_id, role, joined_at) VALUES
      ('gm-l1-a', 'g-liga-1', 'alice', 'owner', '2026-06-01T10:00:00Z'),
      ('gm-l1-b', 'g-liga-1', 'bob', 'member', '2026-06-01T11:00:00Z'),
      ('gm-l1-c', 'g-liga-1', 'carol', 'member', '2026-06-01T12:00:00Z'),
      ('gm-l1-x', 'g-liga-1', 'banned', 'member', '2026-06-01T13:00:00Z'),

      ('gm-l2-b', 'g-liga-2', 'bob', 'owner', '2026-06-02T10:00:00Z'),
      ('gm-l2-a', 'g-liga-2', 'alice', 'member', '2026-06-02T11:00:00Z'),

      ('gm-l3-a', 'g-liga-3', 'alice', 'owner', '2026-06-03T10:00:00Z'),

      ('gm-c1-a', 'g-copa-1', 'alice', 'owner', '2026-06-04T10:00:00Z'),
      ('gm-c2-b', 'g-copa-2', 'bob', 'owner', '2026-06-05T10:00:00Z'),
      ('gm-c2-a', 'g-copa-2', 'alice', 'member', '2026-06-05T11:00:00Z'),

      ('gm-ef-a', 'g-entre-fases', 'alice', 'owner', '2026-06-06T10:00:00Z'),

      ('gm-lf-b', 'g-liga-fim', 'bob', 'owner', '2026-06-07T10:00:00Z'),
      ('gm-lf-a', 'g-liga-fim', 'alice', 'member', '2026-06-07T11:00:00Z'),
      ('gm-lf-c', 'g-liga-fim', 'carol', 'member', '2026-06-07T12:00:00Z'),

      ('gm-cf-a', 'g-copa-fim', 'alice', 'owner', '2026-06-08T10:00:00Z'),
      ('gm-cf-b', 'g-copa-fim', 'bob', 'member', '2026-06-08T11:00:00Z'),

      ('gm-vz-a', 'g-vazia', 'alice', 'owner', '2026-06-09T10:00:00Z'),
      ('gm-pl-a', 'g-piloto', 'alice', 'owner', '2026-06-10T10:00:00Z'),
      ('gm-dl-a', 'g-deletado', 'alice', 'owner', '2026-06-11T10:00:00Z'),
      ('gm-bn-b', 'g-banido', 'bob', 'owner', '2026-06-12T10:00:00Z'),
      ('gm-bn-a', 'g-banido', 'alice', 'member', '2026-06-12T11:00:00Z');

    INSERT INTO group_bans (group_id, user_id) VALUES
      ('g-liga-1', 'banned'),
      ('g-banido', 'alice');

    INSERT INTO leaderboard (group_id, user_id, total_points, exact_hits, last_updated) VALUES
      ('g-liga-1', 'carol', 15, 2, '2026-06-14T00:00:00Z'),
      ('g-liga-1', 'alice', 15, 1, '2026-06-14T00:00:00Z'),
      ('g-liga-1', 'bob', 8, 0, '2026-06-14T00:00:00Z'),
      ('g-liga-1', 'banned', 99, 9, '2026-06-14T00:00:00Z'),

      ('g-liga-fim', 'bob', 20, 3, '2026-05-21T00:00:00Z'),
      ('g-liga-fim', 'carol', 20, 3, '2026-05-21T00:00:00Z'),
      ('g-liga-fim', 'alice', 12, 1, '2026-05-21T00:00:00Z'),

      ('g-copa-fim', 'alice', 18, 2, '2025-05-31T00:00:00Z');

    INSERT INTO predictions (
      id, group_id, user_id, match_id,
      predicted_home_score, predicted_away_score, predicted_penalty_winner, created_at, updated_at
    ) VALUES
      -- g-liga-1: alice palpitou o remarcado e o primeiro da rodada 2
      ('pr-1', 'g-liga-1', 'alice', 'l-r1-rem', 0, 0, NULL, '2026-06-14T00:00:00Z', '2026-06-14T00:00:00Z'),
      ('pr-2', 'g-liga-1', 'alice', 'l-r2-1', 2, 1, NULL, '2026-06-14T00:00:00Z', '2026-06-14T00:00:00Z'),
      -- g-liga-2: alice não palpitou nada (todos os 4 abertos pendentes)
      -- g-liga-3: alice palpitou só o jogo da rodada 2 com horário futuro e o adiado
      ('pr-3', 'g-liga-3', 'alice', 'l-r2-1', 1, 0, NULL, '2026-06-14T00:00:00Z', '2026-06-14T00:00:00Z'),
      ('pr-4', 'g-liga-3', 'alice', 'l-r2-2', 1, 1, NULL, '2026-06-14T00:00:00Z', '2026-06-14T00:00:00Z'),
      ('pr-5', 'g-liga-3', 'alice', 'l-r2-adi', 0, 1, NULL, '2026-06-14T00:00:00Z', '2026-06-14T00:00:00Z'),
      -- g-copa-1: alice palpitou ida 1x0 para fla (casa) e volta 1x0 para pal (casa) sem pênalti -> falta pênalti
      ('pr-6', 'g-copa-1', 'alice', 'c-q1-ida', 1, 0, NULL, '2026-06-09T00:00:00Z', '2026-06-09T00:00:00Z'),
      ('pr-7', 'g-copa-1', 'alice', 'c-q1-volta', 1, 0, NULL, '2026-06-14T00:00:00Z', '2026-06-14T00:00:00Z'),
      -- g-copa-2: mesmo placar na volta, mas com pênalti preenchido e jogo único empatado sem pênalti
      ('pr-8', 'g-copa-2', 'alice', 'c-q1-ida', 1, 0, NULL, '2026-06-09T00:00:00Z', '2026-06-09T00:00:00Z'),
      ('pr-9', 'g-copa-2', 'alice', 'c-q1-volta', 1, 0, 'away', '2026-06-14T00:00:00Z', '2026-06-14T00:00:00Z'),
      ('pr-10', 'g-copa-2', 'alice', 'c-q2-unico', 2, 2, NULL, '2026-06-14T00:00:00Z', '2026-06-14T00:00:00Z');
  `)

  return { sqlite, db }
}

const EXPECTED_ORDINARY = {
  groups: [
    {
      id: 'g-vazia',
      name: 'Grupo Vazio',
      competition_id: 'comp-vazia',
      competition_name: 'Sem Jogos',
      competition_type: 'league',
      competition_code: null,
      competition_status: 'upcoming',
      points_exact: 3,
      is_admin: true,
      created_at: '2026-06-09T10:00:00Z',
      member_count: 1,
      user_position: null,
      user_points: 0,
      pending_predictions: 0,
      next_deadline: null,
      next_match_at: null,
      current_round_label: null,
      current_round_agreement: null,
      round_ends_at: null,
      live_matches: 0,
      podium: null,
    },
    {
      id: 'g-copa-fim',
      name: 'Copa Fim',
      competition_id: 'comp-copa-fim',
      competition_name: 'Copa Encerrada',
      competition_type: 'cup',
      competition_code: 'CL',
      competition_status: 'finished',
      points_exact: 3,
      is_admin: true,
      created_at: '2026-06-08T10:00:00Z',
      member_count: 2,
      user_position: 1,
      user_points: 18,
      pending_predictions: 0,
      next_deadline: null,
      next_match_at: null,
      current_round_label: null,
      current_round_agreement: null,
      round_ends_at: null,
      live_matches: 0,
      podium: [{ position: 1, display: 'Alice', points: 18, is_you: true }],
    },
    {
      id: 'g-liga-fim',
      name: 'Liga Fim',
      competition_id: 'comp-liga-fim',
      competition_name: 'Liga Encerrada',
      competition_type: 'league',
      competition_code: 'PL',
      competition_status: 'finished',
      points_exact: 3,
      is_admin: false,
      created_at: '2026-06-07T10:00:00Z',
      member_count: 3,
      user_position: 3,
      user_points: 12,
      pending_predictions: 0,
      next_deadline: null,
      next_match_at: null,
      current_round_label: null,
      current_round_agreement: null,
      round_ends_at: null,
      live_matches: 0,
      podium: [
        { position: 1, display: 'Beto', points: 20, is_you: false },
        { position: 2, display: 'Carol', points: 20, is_you: false },
        { position: 3, display: 'Alice', points: 12, is_you: true },
      ],
    },
    {
      id: 'g-entre-fases',
      name: 'Entre Fases',
      competition_id: 'comp-entre-fases',
      competition_name: 'Copa Entre Fases',
      competition_type: 'cup',
      competition_code: 'bra.entrefases',
      competition_status: 'ongoing',
      points_exact: 3,
      is_admin: true,
      created_at: '2026-06-06T10:00:00Z',
      member_count: 1,
      user_position: null,
      user_points: 0,
      pending_predictions: 0,
      next_deadline: null,
      next_match_at: null,
      current_round_label: null,
      current_round_agreement: null,
      round_ends_at: null,
      live_matches: 0,
      podium: null,
    },
    {
      id: 'g-copa-2',
      name: 'Copa Pênalti Preenchido',
      competition_id: 'comp-copa',
      competition_name: 'Copa Nacional',
      competition_type: 'cup',
      competition_code: 'bra.copa',
      competition_status: 'ongoing',
      points_exact: 3,
      is_admin: false,
      created_at: '2026-06-05T10:00:00Z',
      member_count: 2,
      user_position: null,
      user_points: 0,
      pending_predictions: 1,
      next_deadline: {
        match_id: 'c-q2-unico',
        round: 'QUARTER_FINALS',
        round_label: 'Quartas de final',
        round_agreement: 'fp',
        home_team: 'Corinthians',
        away_team: 'São Paulo',
        start_time: '2026-06-21T19:00:00Z',
      },
      next_match_at: '2026-06-17T19:00:00Z',
      current_round_label: 'Quartas de final',
      current_round_agreement: 'fp',
      round_ends_at: '2026-06-21T19:00:00Z',
      live_matches: 0,
      podium: null,
    },
    {
      id: 'g-copa-1',
      name: 'Copa Falta Pênalti',
      competition_id: 'comp-copa',
      competition_name: 'Copa Nacional',
      competition_type: 'cup',
      competition_code: 'bra.copa',
      competition_status: 'ongoing',
      points_exact: 3,
      is_admin: true,
      created_at: '2026-06-04T10:00:00Z',
      member_count: 1,
      user_position: null,
      user_points: 0,
      pending_predictions: 2,
      next_deadline: {
        match_id: 'c-q1-volta',
        round: 'QUARTER_FINALS',
        round_label: 'Quartas de final',
        round_agreement: 'fp',
        home_team: 'Palmeiras',
        away_team: 'Flamengo',
        start_time: '2026-06-17T19:00:00Z',
      },
      next_match_at: '2026-06-17T19:00:00Z',
      current_round_label: 'Quartas de final',
      current_round_agreement: 'fp',
      round_ends_at: '2026-06-21T19:00:00Z',
      live_matches: 0,
      podium: null,
    },
    {
      id: 'g-liga-3',
      name: 'Liga Três',
      competition_id: 'comp-liga',
      competition_name: 'Brasileirão 2026',
      competition_type: 'league',
      competition_code: 'BSA',
      competition_status: 'ongoing',
      points_exact: 0,
      is_admin: true,
      created_at: '2026-06-03T10:00:00Z',
      member_count: 1,
      user_position: null,
      user_points: 0,
      pending_predictions: 1,
      next_deadline: {
        match_id: 'l-r1-rem',
        round: '1',
        round_label: 'Rodada 1',
        round_agreement: 'fs',
        home_team: 'São Paulo',
        away_team: 'Palmeiras',
        start_time: '2026-06-18T19:00:00Z',
      },
      next_match_at: '2026-06-18T19:00:00Z',
      current_round_label: 'Rodada 2',
      current_round_agreement: 'fs',
      round_ends_at: '2026-06-25T19:00:00Z',
      live_matches: 1,
      podium: null,
    },
    {
      id: 'g-liga-2',
      name: 'Liga Dois',
      competition_id: 'comp-liga',
      competition_name: 'Brasileirão 2026',
      competition_type: 'league',
      competition_code: 'BSA',
      competition_status: 'ongoing',
      points_exact: 5,
      is_admin: false,
      created_at: '2026-06-02T10:00:00Z',
      member_count: 2,
      user_position: null,
      user_points: 0,
      pending_predictions: 4,
      next_deadline: {
        match_id: 'l-r1-rem',
        round: '1',
        round_label: 'Rodada 1',
        round_agreement: 'fs',
        home_team: 'São Paulo',
        away_team: 'Palmeiras',
        start_time: '2026-06-18T19:00:00Z',
      },
      next_match_at: '2026-06-18T19:00:00Z',
      current_round_label: 'Rodada 2',
      current_round_agreement: 'fs',
      round_ends_at: '2026-06-25T19:00:00Z',
      live_matches: 1,
      podium: null,
    },
    {
      id: 'g-liga-1',
      name: 'Liga Um',
      competition_id: 'comp-liga',
      competition_name: 'Brasileirão 2026',
      competition_type: 'league',
      competition_code: 'BSA',
      competition_status: 'ongoing',
      points_exact: 3,
      is_admin: true,
      created_at: '2026-06-01T10:00:00Z',
      member_count: 3,
      user_position: 2,
      user_points: 15,
      pending_predictions: 2,
      next_deadline: {
        match_id: 'l-r2-2',
        round: '2',
        round_label: 'Rodada 2',
        round_agreement: 'fs',
        home_team: 'Palmeiras',
        away_team: 'São Paulo',
        start_time: '2026-06-22T19:00:00Z',
      },
      next_match_at: '2026-06-18T19:00:00Z',
      current_round_label: 'Rodada 2',
      current_round_agreement: 'fs',
      round_ends_at: '2026-06-25T19:00:00Z',
      live_matches: 1,
      podium: null,
    },
  ],
  matched_invite_group_id: 'g-liga-2',
}

async function fetchGroups(db: D1Database, query = '', pilotEmail?: string) {
  const env: Env = {
    DB: db,
    JWT_SECRET,
    ADMIN_EMAIL: 'admin@palpitae.com.br',
    PILOT_EMAILS: pilotEmail,
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FOOTBALL_API_KEY: 'test-key',
    RESEND_API_KEY: 'test-resend',
  }
  const token = await signJwt(
    { sub: 'alice', email: 'alice@example.com', jti: 'jti-alice-contract' },
    JWT_SECRET,
    3600,
  )
  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext

  return worker.fetch(
    new Request(`https://api.palpitae.com.br/groups${query}`, {
      method: 'GET',
      headers: {
        Cookie: `session=${token}`,
        'CF-Connecting-IP': '192.0.2.50',
      },
    }),
    env,
    ctx,
  )
}

describe('contrato byte a byte de GET /groups com múltiplos grupos e competições', () => {
  it('devolve o JSON esperado para usuário comum com vários grupos por competição', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    const { db } = seedContractFixture()

    const res = await fetchGroups(db, '?invite_code=liga-0002')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    const raw = await res.text()
    expect(raw).toBe(JSON.stringify(EXPECTED_ORDINARY))
  })

  it('inclui grupos de competição piloto apenas para quem tem acesso piloto', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    const { db } = seedContractFixture()

    const res = await fetchGroups(db, '?invite_code=PILO-0001', 'alice@example.com')
    expect(res.status).toBe(200)
    const raw = await res.text()
    const expectedPilot = {
      groups: [
        {
          id: 'g-piloto',
          name: 'Grupo Piloto',
          competition_id: 'comp-piloto',
          competition_name: 'Liga Piloto',
          competition_type: 'league',
          competition_code: 'bra.piloto',
          competition_status: 'ongoing',
          points_exact: 3,
          is_admin: true,
          created_at: '2026-06-10T10:00:00Z',
          member_count: 1,
          user_position: null,
          user_points: 0,
          pending_predictions: 1,
          next_deadline: {
            match_id: 'p-1',
            round: '1',
            round_label: 'Rodada 1',
            round_agreement: 'fs',
            home_team: 'Corinthians',
            away_team: 'Palmeiras',
            start_time: '2026-06-19T19:00:00Z',
          },
          next_match_at: '2026-06-19T19:00:00Z',
          current_round_label: 'Rodada 1',
          current_round_agreement: 'fs',
          round_ends_at: '2026-06-19T19:00:00Z',
          live_matches: 0,
          podium: null,
        },
        ...EXPECTED_ORDINARY.groups,
      ],
      matched_invite_group_id: 'g-piloto',
    }
    expect(raw).toBe(JSON.stringify(expectedPilot))
  })

  it('desempata grupos com o mesmo created_at por id decrescente', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    const { sqlite, db } = seedContractFixture()

    sqlite.exec(`
      INSERT INTO groups (
        id, name, competition_id, owner_user_id, invite_code, points_exact, created_at, deleted_at
      ) VALUES
        ('g-empate-1', 'Empate Um', 'comp-vazia', 'alice', 'EMPA-0001', 3, '2026-06-13T10:00:00Z', NULL),
        ('g-empate-2', 'Empate Dois', 'comp-vazia', 'alice', 'EMPA-0002', 3, '2026-06-13T10:00:00Z', NULL);

      INSERT INTO group_members (id, group_id, user_id, role, joined_at) VALUES
        ('gm-e1-a', 'g-empate-1', 'alice', 'owner', '2026-06-13T10:00:00Z'),
        ('gm-e2-a', 'g-empate-2', 'alice', 'owner', '2026-06-13T10:00:00Z');
    `)

    const res = await fetchGroups(db)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { groups: Array<{ id: string; created_at: string }> }
    expect(body.groups.slice(0, 2).map((g) => g.id)).toEqual(['g-empate-2', 'g-empate-1'])
    expect(body.groups.slice(2).map((g) => g.id)).toEqual(EXPECTED_ORDINARY.groups.map((g) => g.id))
  })
})

describe('GET /groups com mais de 100 grupos encerrados', () => {
  it('devolve 200 e todos os pódios com 120 grupos encerrados sob o limite de 100 binds', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)

    const total = 120
    const groupsSql: string[] = []
    const membersSql: string[] = []
    const leaderboardSql: string[] = []

    for (let i = 1; i <= total; i++) {
      const pad = String(i).padStart(3, '0')
      const groupId = `g-fim-${pad}`
      const inviteCode = `FIM0-${pad}`
      const createdAt = `2026-01-${String(1 + (i % 28)).padStart(2, '0')}T10:00:${String(i % 60).padStart(2, '0')}Z`
      groupsSql.push(
        `('${groupId}', 'Grupo Fim ${pad}', 'comp-fim', 'alice', '${inviteCode}', 3, '${createdAt}')`,
      )
      membersSql.push(
        `('gm-a-${pad}', '${groupId}', 'alice', 'owner', '2026-01-01T10:00:00Z')`,
        `('gm-b-${pad}', '${groupId}', 'bob', 'member', '2026-01-01T11:00:00Z')`,
        `('gm-c-${pad}', '${groupId}', 'carol', 'member', '2026-01-01T12:00:00Z')`,
      )
      leaderboardSql.push(
        `('${groupId}', 'bob', ${200 + i}, 2, '2026-05-01T00:00:00Z')`,
        `('${groupId}', 'alice', ${100 + i}, 1, '2026-05-01T00:00:00Z')`,
        `('${groupId}', 'carol', ${i}, 0, '2026-05-01T00:00:00Z')`,
      )
    }

    sqlite.exec(`
      INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
        ('alice', 'alice@example.com', 'google', 'g-alice', 'Alice'),
        ('bob', 'bob@example.com', 'google', 'g-bob', 'Bob'),
        ('carol', 'carol@example.com', 'google', 'g-carol', 'Carol'),
        ('banned', 'banned@example.com', 'google', 'g-banned', 'Banido');

      INSERT INTO profiles (user_id, nickname) VALUES
        ('alice', 'Alice'),
        ('bob', 'Beto'),
        ('carol', 'Carol'),
        ('banned', 'Banido');

      DELETE FROM competitions;

      INSERT INTO competitions (
        id, name, slug, external_id, provider, season, status, type, penalty_phases, visibility
      ) VALUES
        ('comp-fim', 'Liga Encerrada', 'liga-encerrada-2026', 'PL', 'football-data', '2026', 'finished', 'league', '[]', 'public');

      INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code, points_exact, created_at)
      VALUES ${groupsSql.join(',\n')};

      INSERT INTO group_members (id, group_id, user_id, role, joined_at)
      VALUES ${membersSql.join(',\n')},
             ('gm-ban-001', 'g-fim-001', 'banned', 'member', '2026-01-01T13:00:00Z');

      INSERT INTO group_bans (group_id, user_id) VALUES ('g-fim-001', 'banned');

      INSERT INTO leaderboard (group_id, user_id, total_points, exact_hits, last_updated)
      VALUES ${leaderboardSql.join(',\n')},
             ('g-fim-001', 'banned', 999, 9, '2026-05-01T00:00:00Z');
    `)

    const res = await fetchGroups(limitD1Binds(db))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      groups: Array<{
        id: string
        competition_status: string | null
        podium: Array<{ position: number; display: string; points: number; is_you: boolean }> | null
      }>
    }

    expect(body.groups).toHaveLength(total)
    for (const group of body.groups) {
      const n = Number(group.id.slice('g-fim-'.length))
      expect(group.competition_status).toBe('finished')
      expect(group.podium).toEqual([
        { position: 1, display: 'Beto', points: 200 + n, is_you: false },
        { position: 2, display: 'Alice', points: 100 + n, is_you: true },
        { position: 3, display: 'Carol', points: n, is_you: false },
      ])
    }
  })
})
