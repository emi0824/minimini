import { Squad, SquadStatus } from '@/types/squad';

export const getSquadDepartAt = (squad: Pick<Squad, 'departDate' | 'departTime'>) => {
  if (!squad.departDate || !/^\d{4}-\d{2}-\d{2}$/.test(squad.departDate)) return Number.POSITIVE_INFINITY;
  const time = String(squad.departTime || '').slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(time)) return Number.POSITIVE_INFINITY;
  return new Date(`${squad.departDate}T${time}:00+08:00`).getTime();
};

export const isSquadDeparted = (squad: Pick<Squad, 'departDate' | 'departTime'>, now = Date.now()) => (
  getSquadDepartAt(squad) <= now
);

export const getSquadStatus = (squad: Pick<Squad, 'departDate' | 'departTime' | 'passengers' | 'capacity'>, now = Date.now()): SquadStatus => {
  if (isSquadDeparted(squad, now)) return 'departed';
  return squad.passengers.length >= squad.capacity ? 'ready' : 'recruiting';
};

export const sortSquadsSmart = (items: Squad[], now = Date.now()) => (
  [...items].sort((left, right) => {
    const leftDeparted = isSquadDeparted(left, now);
    const rightDeparted = isSquadDeparted(right, now);
    if (leftDeparted !== rightDeparted) return leftDeparted ? 1 : -1;
    if (leftDeparted && rightDeparted) return getSquadDepartAt(left) - getSquadDepartAt(right);

    const leftReached = left.passengers.length >= left.capacity;
    const rightReached = right.passengers.length >= right.capacity;
    if (leftReached !== rightReached) return leftReached ? 1 : -1;

    const dateDifference = String(left.departDate || '').localeCompare(String(right.departDate || ''));
    if (dateDifference !== 0) return dateDifference;

    const completionDifference = (right.passengers.length / right.capacity) - (left.passengers.length / left.capacity);
    if (completionDifference !== 0) return completionDifference;

    const timeDifference = String(left.departTime).localeCompare(String(right.departTime));
    if (timeDifference !== 0) return timeDifference;
    return Number(left.createdAt || left.id) - Number(right.createdAt || right.id);
  })
);
