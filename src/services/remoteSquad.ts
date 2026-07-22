import type { CreateSquadInput, JoinSquadInput, UpdatePassengerInfoInput } from '@/services/squad';
import { Passenger, Squad, SquadStatus, UserProfile } from '@/types/squad';
import { request } from '@/services/request';
import { getSquadDepartAt, getSquadStatus } from '@/utils/squad';

const normalizeStatus = (squad: Pick<Squad, 'departDate' | 'departTime'>, status: string | undefined, passengers: Passenger[], capacity: number): SquadStatus => {
  if (status === 'cancelled') return status;
  return getSquadStatus({ ...squad, passengers, capacity });
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
    status: normalizeStatus(squad, squad.status, passengers, capacity)
  };
};

export interface RemoteHomeData {
  user: UserProfile;
  squads: Squad[];
}

export interface RemotePassengerInfoResult {
  user: UserProfile;
  squad: Squad;
}

export const getRemoteUser = (): Promise<UserProfile> => request<UserProfile>('/api/users/me');

export const updateRemoteNickname = (nickname: string): Promise<UserProfile> => (
  request<UserProfile>('/api/users/me', 'PUT', { nickname })
);

export const updateRemoteProfile = (nickname: string, gameId: string): Promise<UserProfile> => (
  request<UserProfile>('/api/users/me', 'PUT', { nickname, gameId })
);

export const getRemoteSquads = async (): Promise<Squad[]> => {
  const squads = await request<Squad[]>('/api/squads');
  return squads.map(normalizeSquad);
};

export const getRemoteHome = async (): Promise<RemoteHomeData> => {
  const result = await request<RemoteHomeData>('/api/home', 'GET', undefined, { showLoading: false });
  return {
    user: result.user,
    squads: result.squads.map(normalizeSquad)
  };
};

export const getRemoteSquadById = async (id: number): Promise<Squad> => normalizeSquad(await request<Squad>(`/api/squads/${id}`));

export const getRemoteNearbySquads = async (departDate: string, departTime: string, excludeId = 0): Promise<Squad[]> => {
  const targetAt = getSquadDepartAt({ departDate, departTime });
  const squads = await getRemoteSquads();
  return squads.filter((squad) => (
    squad.id !== excludeId
    && squad.departDate === departDate
    && Math.abs(getSquadDepartAt(squad) - targetAt) <= 30 * 60 * 1000
  ));
};

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

export const updateRemotePassengerInfo = async (squadId: number, input: UpdatePassengerInfoInput): Promise<RemotePassengerInfoResult> => {
  const result = await request<RemotePassengerInfoResult>(`/api/squads/${squadId}/passengers/me`, 'PUT', input);
  return { user: result.user, squad: normalizeSquad(result.squad) };
};

export const dismissRemoteSquad = (squadId: number): Promise<void> => (
  request<void>(`/api/squads/${squadId}`, 'DELETE')
);
