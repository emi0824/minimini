import { isRemoteApiEnabled } from '@/config/api';
import { bindWechatUserWithNickname, getCurrentUser, saveUserProfile, updateNickname, updateProfile } from '@/services/auth';
import { ensureActiveAccess } from '@/services/accessControl';
import {
  createSquad,
  CreateSquadInput,
  dismissSquad,
  getSquadById,
  getNearbySquads,
  getSquads,
  joinSquad,
  JoinSquadInput,
  leaveSquad,
  syncNicknameInSquads,
  UpdatePassengerInfoInput,
  updatePassengerInfo,
  updateSquad
} from '@/services/squad';
import {
  createRemoteSquad,
  dismissRemoteSquad,
  getRemoteSquadById,
  getRemoteHome,
  getRemoteNearbySquads,
  getRemoteSquads,
  joinRemoteSquad,
  leaveRemoteSquad,
  updateRemotePassengerInfo,
  updateRemoteProfile,
  updateRemoteNickname,
  updateRemoteSquad
} from '@/services/remoteSquad';
import { Squad, UserProfile } from '@/types/squad';

export interface HomeData {
  user: UserProfile;
  squads: Squad[];
}

export interface PassengerInfoResult {
  user: UserProfile;
  squad: Squad;
}

export const getHomeApi = async (): Promise<HomeData> => {
  if (isRemoteApiEnabled()) {
    const result = await getRemoteHome();
    return { ...result, user: saveUserProfile(result.user) };
  }
  return { user: getCurrentUser(), squads: getSquads() };
};

export const updateNicknameApi = async (nickname: string): Promise<UserProfile> => {
  if (isRemoteApiEnabled()) {
    await bindWechatUserWithNickname(nickname);
    return saveUserProfile(await updateRemoteNickname(nickname));
  }
  const user = updateNickname(nickname);
  syncNicknameInSquads(user.openid, nickname);
  return user;
};

export const updateProfileApi = async (nickname: string, gameId: string): Promise<UserProfile> => {
  if (isRemoteApiEnabled()) {
    await bindWechatUserWithNickname(nickname);
    return saveUserProfile(await updateRemoteProfile(nickname, gameId));
  }
  const user = updateProfile({ nickname, gameId });
  syncNicknameInSquads(user.openid, nickname, gameId);
  return user;
};

export const getSquadsApi = async (): Promise<Squad[]> => {
  if (isRemoteApiEnabled()) return getRemoteSquads();
  return getSquads();
};

export const getSquadByIdApi = async (id: number): Promise<Squad | undefined> => {
  if (isRemoteApiEnabled()) return getRemoteSquadById(id);
  return getSquadById(id);
};

export const getNearbySquadsApi = async (departDate: string, departTime: string, excludeId = 0): Promise<Squad[]> => {
  if (isRemoteApiEnabled()) return getRemoteNearbySquads(departDate, departTime, excludeId);
  return getNearbySquads(departDate, departTime, excludeId);
};

export const createSquadApi = async (input: CreateSquadInput): Promise<Squad> => {
  if (isRemoteApiEnabled()) {
    await ensureActiveAccess();
    return createRemoteSquad(input);
  }
  return createSquad(input);
};

export const updateSquadApi = async (squadId: number, input: CreateSquadInput): Promise<Squad> => {
  if (isRemoteApiEnabled()) {
    await ensureActiveAccess();
    return updateRemoteSquad(squadId, input);
  }
  return updateSquad(squadId, input);
};

export const joinSquadApi = async (squadId: number, input: JoinSquadInput): Promise<Squad> => {
  if (isRemoteApiEnabled()) {
    await ensureActiveAccess();
    return joinRemoteSquad(squadId, input);
  }
  const user = updateProfile({ nickname: input.nickname.trim(), gameId: input.gameId.trim() });
  syncNicknameInSquads(user.openid, user.nickname, user.gameId);
  return joinSquad(squadId, input);
};

export const leaveSquadApi = async (squadId: number): Promise<Squad> => {
  if (isRemoteApiEnabled()) {
    await ensureActiveAccess();
    return leaveRemoteSquad(squadId);
  }
  return leaveSquad(squadId);
};

export const updatePassengerInfoApi = async (squadId: number, input: UpdatePassengerInfoInput): Promise<PassengerInfoResult> => {
  if (isRemoteApiEnabled()) {
    const result = await updateRemotePassengerInfo(squadId, input);
    return { ...result, user: saveUserProfile(result.user) };
  }

  const user = updateProfile({ nickname: input.nickname.trim(), gameId: input.gameId.trim() });
  syncNicknameInSquads(user.openid, user.nickname, user.gameId);
  return { user, squad: updatePassengerInfo(squadId, input) };
};

export const dismissSquadApi = async (squadId: number): Promise<void> => {
  if (isRemoteApiEnabled()) {
    await ensureActiveAccess();
    return dismissRemoteSquad(squadId);
  }
  return dismissSquad(squadId);
};
