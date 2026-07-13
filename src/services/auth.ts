import Taro from '@tarojs/taro';
import { UserProfile } from '@/types/squad';
import { request } from '@/services/request';

const USER_KEY = 'gangwa_user_profile';
const TOKEN_KEY = 'gangwa_auth_token';

interface LoginResponse {
  token: string;
  user: UserProfile;
}

const createGuestOpenid = () => `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const getAuthToken = () => Taro.getStorageSync<string>(TOKEN_KEY) || '';

export const hasAuthSession = () => Boolean(getAuthToken());

export const saveUserProfile = (user: UserProfile) => {
  Taro.setStorageSync(USER_KEY, user);
  return user;
};

const saveSession = ({ token, user }: LoginResponse) => {
  Taro.setStorageSync(TOKEN_KEY, token);
  return saveUserProfile(user);
};

export const getCurrentUser = (): UserProfile => {
  const cached = Taro.getStorageSync<UserProfile>(USER_KEY);
  if (cached?.openid) return cached;

  const user: UserProfile = {
    openid: createGuestOpenid(),
    nickname: '未命名成员',
    joinedSquadIds: [],
    createdSquadIds: []
  };
  Taro.setStorageSync(USER_KEY, user);
  console.info('[Auth] init local user', { openid: user.openid });
  return user;
};

const loginWithWechat = async (nickname: string): Promise<UserProfile> => {
  const loginResult = await Taro.login();
  if (!loginResult.code) throw new Error('微信登录失败');
  return saveSession(await request<LoginResponse>('/api/auth/wechat-login', 'POST', { code: loginResult.code, nickname }, { skipAuth: true }));
};

export const refreshWechatSession = async (nickname?: string): Promise<UserProfile> => {
  if (Taro.getEnv() === Taro.ENV_TYPE.WEB) throw new Error('H5 预览不支持刷新微信登录态');
  const cached = getCurrentUser();
  return loginWithWechat(nickname?.trim() || cached.nickname || '未命名成员');
};

const loginAsGuest = async (nickname: string): Promise<UserProfile> => (
  saveSession(await request<LoginResponse>('/api/auth/guest-login', 'POST', { nickname }, { skipAuth: true }))
);

export const ensureAuthenticatedUser = async (nickname?: string): Promise<UserProfile> => {
  const cached = getCurrentUser();
  if (getAuthToken()) return cached;

  if (Taro.getEnv() === Taro.ENV_TYPE.WEB) throw new Error('H5 预览不开放写操作，请使用小程序预览');

  const confirmResult = await Taro.showModal({
    title: '授权微信身份',
    content: '保存昵称需要授权获取微信身份，用于绑定 openid 并保护你的车队操作。',
    confirmText: '授权保存',
    cancelText: '暂不保存'
  });
  if (!confirmResult.confirm) throw new Error('已取消授权');

  const finalNickname = nickname?.trim() || cached.nickname || '未命名成员';
  return loginWithWechat(finalNickname);
};

export const updateNickname = (nickname: string): UserProfile => {
  const user = getCurrentUser();
  const nextUser = { ...user, nickname };
  Taro.setStorageSync(USER_KEY, nextUser);
  console.info('[Auth] update nickname');
  return nextUser;
};
