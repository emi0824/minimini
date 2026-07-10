import Taro from '@tarojs/taro';
import { ensureAuthenticatedUser, getAuthToken, getCurrentUser, saveUserProfile } from '@/services/auth';
import { request } from '@/services/request';
import { UserProfile } from '@/types/squad';

export interface AccessState {
  user: UserProfile;
  isAdmin: boolean;
  isRootAdmin: boolean;
  isDisabled: boolean;
  isGroupVerified: boolean;
  needsGroupVerify: boolean;
  message: string;
}

const isWeb = () => Taro.getEnv() === Taro.ENV_TYPE.WEB;

export const getMe = async () => {
  const user = await request<UserProfile>('/api/users/me');
  return saveUserProfile(user);
};

export const getAccessState = async (): Promise<AccessState> => {
  const user = await getMe();
  const isAdmin = user.role === 'admin';
  const isRootAdmin = user.isRootAdmin === true;
  const isDisabled = user.disabled === true;
  const isGroupVerified = isAdmin || user.groupVerified === true;
  const needsGroupVerify = !isDisabled && !isGroupVerified;
  const message = isDisabled
    ? (user.disabledReason || '账号已被管理员禁用')
    : needsGroupVerify
      ? '请从指定微信群进入完成准入验证'
      : '权限正常';

  return { user, isAdmin, isRootAdmin, isDisabled, isGroupVerified, needsGroupVerify, message };
};

export const ensureActiveAccess = async () => {
  await ensureAuthenticatedUser();
  const state = await getAccessState();
  if (state.isDisabled || state.needsGroupVerify) throw new Error(state.message);
  return state;
};

export const ensureAuthorizedOrRedirect = async () => {
  const cached = getCurrentUser();
  if (!getAuthToken() || cached.nickname === '未命名成员') {
    Taro.showToast({ title: '请先授权并填写昵称', icon: 'none' });
    setTimeout(() => Taro.switchTab({ url: '/pages/mine/index' }), 350);
    return false;
  }

  try {
    const state = await getAccessState();
    if (state.isDisabled || state.needsGroupVerify) {
      Taro.showToast({ title: state.message, icon: 'none' });
      setTimeout(() => Taro.switchTab({ url: '/pages/mine/index' }), 350);
      return false;
    }
    return true;
  } catch (error) {
    Taro.showToast({ title: '授权已失效，请重新授权', icon: 'none' });
    setTimeout(() => Taro.switchTab({ url: '/pages/mine/index' }), 350);
    return false;
  }
};

export const verifyWechatGroupAccess = async () => {
  await ensureAuthenticatedUser();
  if (isWeb()) throw new Error('H5 预览无法完成微信群验证，请使用微信小程序从群卡片进入');

  const launchOptions = Taro.getLaunchOptionsSync?.();
  const shareTicket = launchOptions?.shareTicket;
  if (!shareTicket) throw new Error('请从指定微信群的小程序卡片进入后再验证');

  const shareInfo = await Taro.getShareInfo({ shareTicket });
  const result = await request<{ user: UserProfile; groupOpenGid: string }>('/api/users/me/group-verify', 'POST', {
    encryptedData: shareInfo.encryptedData,
    iv: shareInfo.iv
  });
  saveUserProfile(result.user);
  return result;
};

export const bindWechatGroup = async () => {
  await ensureAuthenticatedUser();
  if (isWeb()) throw new Error('H5 预览无法绑定微信群，请使用微信小程序从目标群卡片进入');

  const launchOptions = Taro.getLaunchOptionsSync?.();
  const shareTicket = launchOptions?.shareTicket;
  if (!shareTicket) throw new Error('请管理员从目标微信群的小程序卡片进入后再绑定');

  const shareInfo = await Taro.getShareInfo({ shareTicket });
  return request<{ allowedGroupOpenGid: string; boundBy: string }>('/api/admin/group/bind', 'POST', {
    encryptedData: shareInfo.encryptedData,
    iv: shareInfo.iv
  });
};

export const getAdminUsers = () => request<UserProfile[]>('/api/admin/users');

export const disableUser = (openid: string, reason: string) => (
  request<UserProfile>(`/api/admin/users/${encodeURIComponent(openid)}/disable`, 'POST', { reason })
);

export const enableUser = (openid: string) => (
  request<UserProfile>(`/api/admin/users/${encodeURIComponent(openid)}/enable`, 'POST')
);

export const promoteUserToAdmin = (openid: string) => (
  request<UserProfile>(`/api/admin/users/${encodeURIComponent(openid)}/promote`, 'POST')
);

export const demoteAdminUser = (openid: string) => (
  request<UserProfile>(`/api/admin/users/${encodeURIComponent(openid)}/demote`, 'POST')
);

export const getCachedAccessUser = () => getCurrentUser();
