import { isRemoteApiEnabled } from '@/config/api';
import { bindWechatUserWithNickname, getCurrentUser, saveUserProfile, updateNickname } from '@/services/auth';
import { ensureActiveAccess } from '@/services/accessControl';
import {
  createSquad,
  CreateSquadInput,
  dismissSquad,
  getSquadById,
  getSquads,
  joinSquad,
  JoinSquadInput,
  leaveSquad,
  resetSquads,
  syncNicknameInSquads,
  updateSquad
} from '@/services/squad';
import {
  createRemoteSquad,
  dismissRemoteSquad,
  getRemoteSquadById,
  getRemoteHome,
  getRemoteSquads,
  joinRemoteSquad,
  leaveRemoteSquad,
  updateRemoteNickname,
  updateRemoteSquad
} from '@/services/remoteSquad';
import { Squad, UserProfile } from '@/types/squad';

export interface HomeData {
  user: UserProfile;
  squads: Squad[];
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

export const getSquadsApi = async (): Promise<Squad[]> => {
  if (isRemoteApiEnabled()) return getRemoteSquads();
  return getSquads();
};

export const getSquadByIdApi = async (id: number): Promise<Squad | undefined> => {
  if (isRemoteApiEnabled()) return getRemoteSquadById(id);
  return getSquadById(id);
};

export const createSquadApi = async (input: CreateSquadInput): Promise<Squad> => {
  if (isRemoteApiEnabled()) {
    const state = await ensureActiveAccess();
    if (state.user.nickname && state.user.nickname !== '未命名成员') await updateRemoteNickname(state.user.nickname);
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
    const state = await ensureActiveAccess();
    if (state.user.nickname && state.user.nickname !== '未命名成员') await updateRemoteNickname(state.user.nickname);
    return joinRemoteSquad(squadId, input);
  }
  return joinSquad(squadId, input);
};

export const leaveSquadApi = async (squadId: number): Promise<Squad> => {
  if (isRemoteApiEnabled()) {
    await ensureActiveAccess();
    return leaveRemoteSquad(squadId);
  }
  return leaveSquad(squadId);
};

export const dismissSquadApi = async (squadId: number): Promise<void> => {
  if (isRemoteApiEnabled()) {
    await ensureActiveAccess();
    return dismissRemoteSquad(squadId);
  }
  return dismissSquad(squadId);
};

export const resetSquadsApi = async (): Promise<void> => {
  if (!isRemoteApiEnabled()) resetSquads();
};
