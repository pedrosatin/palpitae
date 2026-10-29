import { describe, expect, it } from 'vitest'
import { eventLabel, httpContextLabel, providerLabel, syncErrorOriginLabel } from './labels'

describe('labels', () => {
  describe('eventLabel', () => {
    it('returns translated label for known event types', () => {
      expect(eventLabel('login_success')).toBe('Login')
      expect(eventLabel('group_created')).toBe('Grupo criado')
    })

    it('traduz os tipos de operação que antes apareciam crus', () => {
      for (const type of [
        'match_results_fallback',
        'provider_http_attempt',
        'radar_sync_run',
        'radar_sync_error',
        'security_storage_error',
      ]) {
        expect(eventLabel(type)).not.toBe(type)
      }
      expect(eventLabel('match_results_fallback')).toBe('Fallback de resultados (ESPN)')
    })

    it('não rotula football_api_error como exclusivo de um provedor', () => {
      expect(eventLabel('football_api_error')).toBe('Erro de sync de provedor')
      expect(eventLabel('football_api_error')).not.toMatch(/Football/)
    })

    it('returns raw key for unknown event types', () => {
      expect(eventLabel('unknown_event')).toBe('unknown_event')
      expect(eventLabel('another_unknown')).toBe('another_unknown')
    })
  })

  describe('rótulos de provedor e processo', () => {
    it('traduz provedor, processo da tentativa e origem do erro de sync', () => {
      expect(providerLabel('espn')).toBe('ESPN')
      expect(providerLabel('football-data')).toBe('football-data.org')
      expect(httpContextLabel('fallback')).toBe('Fallback de resultados')
      expect(httpContextLabel('sync')).toBe('Sincronização manual')
      expect(syncErrorOriginLabel('fixture_discovery')).toBe('Descoberta de jogos')
    })

    it('valor desconhecido volta cru', () => {
      expect(providerLabel('novo')).toBe('novo')
      expect(httpContextLabel('novo')).toBe('novo')
      expect(syncErrorOriginLabel('novo')).toBe('novo')
    })
  })
})
