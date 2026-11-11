import type { GroupWithStats } from '../components/GroupCard'

/** Grupo em que o usuário já tem posição no ranking. */
export type RankedGroup = GroupWithStats & { user_position: number }

export function hasPosition(group: GroupWithStats): group is RankedGroup {
  return group.user_position !== null
}

/** Posição como o card e o cabeçalho do grupo mostram. Sem posição, um travessão. */
export function positionLabel(position: number | null): string {
  return position === null ? '—' : `#${position}`
}
