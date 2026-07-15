import type { CreateSquadInput, JoinSquadInput } from '@/services/squad';
import { Passenger, Squad, SquadStatus, UserProfile } from '@/types/squad';
import { request } from '@/services/request';

const normalizeStatus = (status: string | undefined, passengers: Passenger[], capacity: number): SquadStatus => {
  if (status === 'departed' || status === 'cancelled') return status;
  return passengers.length >= capacity ? 'ready' : 'recruiting';
};

const normalizeSquad = (squad: Squad): Squad => {
  const passengers = Array.isArray(squad.passengers) ? squad.passengers : [];
  const tags = Array.isArray(squad.tags) ? squad.tags : [];
  const capacity = Number(squad.capacity || 5);

  return {
    ...squad,
    capacity,
    tags,
    passengers,
    title: squad.title || '未命名车队',
    code: squad.code || '自定义车队',
    creatorName: squad.creatorName || '未知发起人',
    departDate: squad.departDate,
    departTime: (squad.departTime || '--:--').slice(0, 5),
    note: squad.note || '无备注',
    status: normalizeStatus(squad.status, passengers, capacity)
  };
};

export const getRemoteUser = (): Promise<UserProfile> => request<UserProfile>('/api/users/me');

export const updateRemoteNickname = (nickname: string): Promise<UserProfile> => (
  request<UserProfile>('/api/users/me', 'PUT', { nickname })
);

export const getRemoteSquads = async (): Promise<Squad[]> => {
  const squads = await request<Squad[]>('/api/squads');
  return squads.map(normalizeSquad);
};

export const getRemoteSquadById = async (id: number): Promise<Squad> => normalizeSquad(await request<Squad>(`/api/squads/${id}`));

export const createRemoteSquad = async (input: CreateSquadInput): Promise<Squad> => (
  normalizeSquad(await request<Squad>('/api/squads', 'POST', input))
);

export const updateRemoteSquad = async (squadId: number, input: CreateSquadInput): Promise<Squad> => (
  normalizeSquad(await request<Squad>(`/api/squads/${squadId}`, 'PUT', input))
);

export const joinRemoteSquad = async (squadId: number, input: JoinSquadInput): Promise<Squad> => (
  normalizeSquad(await request<Squad>(`/api/squads/${squadId}/join`, 'POST', input))
);

export const leaveRemoteSquad = async (squadId: number): Promise<Squad> => (
  normalizeSquad(await request<Squad>(`/api/squads/${squadId}/leave`, 'POST'))
);

export const dismissRemoteSquad = (squadId: number): Promise<void> => (
  request<void>(`/api/squads/${squadId}`, 'DELETE')
);
