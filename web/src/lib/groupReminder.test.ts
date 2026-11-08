import { describe, expect, it } from 'vitest'
import { makeMatch } from '../components/matchFixtures'
import {
  buildReminderMessage,
  joinNames,
  memberInitials,
  missingLabel,
  pickersCountLabel,
  roundReminder,
  type GroupMember,
} from './groupReminder'

const members: GroupMember[] = [
  { user_id: 'u1', display: 'Pedro Satin' },
  { user_id: 'u2', display: 'Ana' },
  { user_id: 'u3', display: 'Bruno' },
]

const EARLY = '2026-11-14T21:30:00.000Z'
const LATE = '2026-11-18T22:00:00.000Z'
const LINK = 'https://palpitae.com.br/grupos/abc?rodada=35'

describe('roundReminder', () => {
  it('lista quem falta em algum jogo e usa o primeiro jogo em que falta alguém', () => {
    const matches = [
      makeMatch({ id: 'a', start_time: EARLY }),
      makeMatch({ id: 'b', start_time: LATE }),
    ]
    const reminder = roundReminder(matches, members, { a: ['u1', 'u2', 'u3'], b: ['u1'] })
    expect(reminder?.missing.map((m) => m.user_id)).toEqual(['u2', 'u3'])
    expect(reminder?.deadline).toBe(LATE)
  })

  it('devolve lista vazia e prazo nulo quando todo mundo palpitou', () => {
    const matches = [makeMatch({ id: 'a', start_time: EARLY })]
    expect(roundReminder(matches, members, { a: ['u1', 'u2', 'u3'] })).toEqual({
      missing: [],
      deadline: null,
    })
  })

  it('ignora jogo adiado, que não tem prazo a citar', () => {
    const matches = [
      makeMatch({ id: 'a', start_time: EARLY }),
      makeMatch({ id: 'b', start_time: '2020-01-01T00:00:00.000Z', postponed: 1 }),
    ]
    const reminder = roundReminder(matches, members, { a: ['u1', 'u2', 'u3'] })
    expect(reminder?.missing).toEqual([])
  })

  it('devolve null sem jogo aberto com data', () => {
    expect(roundReminder([makeMatch({ id: 'b', postponed: 1 })], members, {})).toBeNull()
    expect(roundReminder([], members, {})).toBeNull()
  })
})

describe('joinNames', () => {
  it('usa vírgula e "e" antes do último nome', () => {
    expect(joinNames(['Ana'])).toBe('Ana')
    expect(joinNames(['Ana', 'Bruno'])).toBe('Ana e Bruno')
    expect(joinNames(['Ana', 'Bruno', 'Carla'])).toBe('Ana, Bruno e Carla')
  })

  it('resume o que passa do limite com "e mais N"', () => {
    expect(joinNames(['Ana', 'Bruno', 'Carla', 'Davi'], 2)).toBe('Ana, Bruno e mais 2')
  })
})

describe('missingLabel', () => {
  it('lista os outros e coloca quem vê no fim como "você"', () => {
    expect(missingLabel([members[1], members[2]], 'u1')).toBe('Faltam palpitar: Ana e Bruno')
    expect(missingLabel([members[0], members[1]], 'u1')).toBe('Faltam palpitar: Ana e você')
  })

  it('reserva a vaga de "você" quando faltam mais de 10 pessoas', () => {
    const many: GroupMember[] = Array.from({ length: 12 }, (_, i) => ({
      user_id: `x${i}`,
      display: `Membro ${i + 1}`,
    }))
    const label = missingLabel([...many, members[0]], 'u1')
    expect(label).toBe(
      'Faltam palpitar: Membro 1, Membro 2, Membro 3, Membro 4, Membro 5, Membro 6, ' +
        'Membro 7, Membro 8, Membro 9, você e mais 3',
    )
  })

  it('usa o singular com uma pessoa', () => {
    expect(missingLabel([members[1]], 'u1')).toBe('Falta palpitar: Ana')
  })

  it('avisa quando só falta quem está vendo', () => {
    expect(missingLabel([members[0]], 'u1')).toBe('Só falta você palpitar')
  })
})

describe('pickersCountLabel', () => {
  it('concorda com o número', () => {
    expect(pickersCountLabel(4, 6)).toBe('4 de 6 palpitaram')
    expect(pickersCountLabel(1, 6)).toBe('1 de 6 palpitou')
    expect(pickersCountLabel(0, 6)).toBe('0 de 6 palpitaram')
  })
})

describe('memberInitials', () => {
  it('pega a primeira e a última palavra', () => {
    expect(memberInitials('Pedro Henrique Satin')).toBe('PS')
  })

  it('usa duas letras em nome de uma palavra', () => {
    expect(memberInitials('ana')).toBe('AN')
  })

  it('não quebra com nome vazio', () => {
    expect(memberInitials('  ')).toBe('?')
  })
})

describe('buildReminderMessage', () => {
  const base = {
    roundLabel: 'Rodada 35',
    groupName: 'Realidade do BR',
    deadline: EARLY,
    link: LINK,
  }

  it('traz rodada, grupo, nomes e o dia da semana calculado', () => {
    const message = buildReminderMessage({ ...base, missing: ['Ana Lima', 'Bruno'] })
    expect(message).toBe(
      'Rodada 35 do bolão "Realidade do BR". Ana e Bruno ainda não palpitaram. ' +
        'O próximo prazo é sáb, 14/11 às 18:30.',
    )
  })

  it('cita o nome do grupo entre aspas', () => {
    const message = buildReminderMessage({ ...base, groupName: 'Bolão da Firma', missing: ['Ana'] })
    expect(message).toContain('do bolão "Bolão da Firma". Ana')
  })

  it('troca e-mail mascarado por "Palpiteiro"', () => {
    const message = buildReminderMessage({ ...base, missing: ['pe***@gmail.com', 'Ana'] })
    expect(message).toContain('Palpiteiro e Ana ainda não palpitaram.')
    expect(message).not.toContain('***')
  })

  it('não usa travessão', () => {
    const message = buildReminderMessage({ ...base, missing: ['Ana', 'Bruno'] })
    expect(message).not.toMatch(/[—–]/)
  })

  it('usa o singular com uma pessoa', () => {
    expect(buildReminderMessage({ ...base, missing: ['Ana'] })).toContain('Ana ainda não palpitou.')
  })

  it('cita até 5 nomes e resume o resto', () => {
    const message = buildReminderMessage({
      ...base,
      missing: ['Ana', 'Bruno', 'Carla', 'Davi', 'Elisa', 'Fábio', 'Gabi'],
    })
    expect(message).toContain('Ana, Bruno, Carla, Davi, Elisa e mais 2 ainda não palpitaram.')
    expect(`${message} ${LINK}`.length).toBeLessThanOrEqual(280)
  })

  it('cabe em 280 caracteres com 5 nomes longos, cortando quantos nomes for preciso', () => {
    const long = (letter: string) => letter.repeat(38)
    const message = buildReminderMessage({
      ...base,
      groupName: 'G'.repeat(30),
      missing: [long('a'), long('b'), long('c'), long('d'), long('e')],
    })
    expect(`${message} ${LINK}`.length).toBeLessThanOrEqual(280)
    expect(message).toMatch(/e mais \d/)
  })

  it('mantém o nome inteiro de quem divide o primeiro nome', () => {
    const message = buildReminderMessage({
      ...base,
      missing: ['Pedro Silva', 'Pedro Souza', 'Ana Lima'],
    })
    expect(message).toContain('Pedro Silva, Pedro Souza e Ana ainda não palpitaram.')
  })
})
