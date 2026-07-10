import Taro from '@tarojs/taro';
import { ensureAuthenticatedUser, saveUserProfile } from '@/services/auth';
import { request } from '@/services/request';
import { UserProfile } from '@/types/squad';

export const SUBSCRIBE_TEMPLATE_IDS = {
  squadMemberChanged: 'lsmPbz6F-1use0Ej3i5rFucq75PZhWNhJKb2AQdxES0',
  squadStatusChanged: 'm_8t4Gz308eRqgkBF0u1voEpiFkFbgsavi2skoL_FDg'
};

const registerSubscriptions = async (tmplIds: string[]) => {
  if (tmplIds.length === 0) return;
  await ensureAuthenticatedUser();
  const user = await request<UserProfile>('/api/users/me/subscriptions', 'POST', { tmplIds });
  saveUserProfile(user);
};

const requestSubscribe = async (tmplIds: string[]) => {
  if (Taro.getEnv() === Taro.ENV_TYPE.WEB) return { accepted: [], rejected: tmplIds };

  try {
    const result = await Taro.requestSubscribeMessage({ tmplIds });
    const accepted = tmplIds.filter((id) => result[id] === 'accept');
    const rejected = tmplIds.filter((id) => result[id] !== 'accept');
    await registerSubscriptions(accepted);
    return { accepted, rejected };
  } catch (error) {
    console.warn('[Subscribe] request skipped', error);
    return { accepted: [], rejected: tmplIds };
  }
};

export const requestSquadMemberChangeSubscribe = () => (
  requestSubscribe([SUBSCRIBE_TEMPLATE_IDS.squadMemberChanged])
);

export const requestSquadStatusChangeSubscribe = () => (
  requestSubscribe([SUBSCRIBE_TEMPLATE_IDS.squadStatusChanged])
);

export const requestAllSquadSubscribes = () => (
  requestSubscribe([SUBSCRIBE_TEMPLATE_IDS.squadMemberChanged, SUBSCRIBE_TEMPLATE_IDS.squadStatusChanged])
);
