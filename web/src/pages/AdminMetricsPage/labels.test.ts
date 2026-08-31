import { describe, it, expect } from 'vitest'
import { eventLabel } from './labels'

describe('eventLabel', () => {
  it('returns the translated label for known event types', () => {
    expect(eventLabel('prediction_saved')).toBe('Palpite salvo')
    expect(eventLabel('login_success')).toBe('Login')
    expect(eventLabel('email_reminder_sent')).toBe('Lembrete enviado')
  })

  it('returns the input type as fallback for unknown event types', () => {
    expect(eventLabel('unknown_event')).toBe('unknown_event')
    expect(eventLabel('another_unknown')).toBe('another_unknown')
  })
})
