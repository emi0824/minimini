import Taro from '@tarojs/taro';
import { ensureAuthenticatedUser, getAuthToken, getCurrentUser, refreshWechatSession, saveUserProfile } from '@/services/auth';
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

export interface GroupBindingState {
  isBound: boolean;
  allowedGroupOpenGid: string;
  boundAt: number;
  boundBy: string;
}

const isWeb = () => Taro.getEnv() === Taro.ENV_TYPE.WEB;
const SHARE_TICKET_KEY = 'gangwa_latest_share_ticket';
const SHARE_TICKET_TTL = 5 * 60 * 1000;

interface ShareTicketCache {
  ticket: string;
  cachedAt: number;
}

const saveShareTicket = (ticket: string) => {
  Taro.setStorageSync(SHARE_TICKET_KEY, { ticket, cachedAt: Date.now() });
};

const getCachedShareTicket = () => {
  const cached = Taro.getStorageSync<ShareTicketCache>(SHARE_TICKET_KEY);
  if (!cached?.ticket || Date.now() - Number(cached.cachedAt || 0) > SHARE_TICKET_TTL) {
    Taro.removeStorageSync(SHARE_TICKET_KEY);
    return '';
  }
  return cached.ticket;
};

export const clearCachedShareTicket = () => {
  Taro.removeStorageSync(SHARE_TICKET_KEY);
};

export const cacheCurrentShareTicket = (ticket?: string) => {
  const enterOptions = Taro.getEnterOptionsSync?.();
  const launchOptions = Taro.getLaunchOptionsSync?.();
  const routeParams = Taro.getCurrentInstance?.().router?.params;
  const shareTicket = ticket || routeParams?.shareTicket || enterOptions?.shareTicket || launchOptions?.shareTicket || '';
  if (shareTicket) saveShareTicket(shareTicket);
  return shareTicket;
};

const getCurrentShareTicket = (ticket?: string) => cacheCurrentShareTicket(ticket) || getCachedShareTicket();

const getErrorMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error && error.message
    ? error.message
    : error && typeof error === 'object' && 'errMsg' in error && typeof error.errMsg === 'string'
      ? error.errMsg
      : '';
  if (message.includes('invalid shareTicket')) return '微信群凭证已失效，请回到绑定微信群，重新点击最新的小程序卡片进入';
  return message || fallback;
};

const withTimeout = async <T,>(promise: Promise<T>, message: string, timeout = 8000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeout);
      })
    ]);
  } catch (error) {
    throw new Error(getErrorMessage(error, message));
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const getMe = async () => {
  const user = await request<UserProfile>('/api/users/me');
  return saveUserProfile(user);
};

const createAccessState = (user: UserProfile): AccessState => {
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

export const getCachedAccessState = () => createAccessState(getCurrentUser());

export const getAccessState = async (): Promise<AccessState> => createAccessState(await getMe());

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
    setTimeout(() => Taro.redirectTo({ url: '/pages/index/index?tab=mine' }), 350);
    return false;
  }

  try {
    const state = await getAccessState();
    if (state.isDisabled) {
      Taro.showToast({ title: state.message, icon: 'none' });
      setTimeout(() => Taro.redirectTo({ url: '/pages/index/index?tab=mine' }), 350);
      return false;
    }
    if (state.needsGroupVerify) {
      await verifyWechatGroupAccess();
    }
    return true;
  } catch (error) {
    Taro.showToast({ title: error instanceof Error ? error.message : '授权已失效，请重新授权', icon: 'none' });
    setTimeout(() => Taro.redirectTo({ url: '/pages/index/index?tab=mine' }), 350);
    return false;
  }
};

export const verifyWechatGroupAccess = async (ticket?: string) => {
  await refreshWechatSession();
  if (isWeb()) throw new Error('H5 预览无法完成微信群验证，请使用微信小程序从群卡片进入');

  const shareTicket = getCurrentShareTicket(ticket);
  if (!shareTicket) throw new Error('未获取到微信群凭证，请回到绑定微信群，重新点击最新的小程序卡片进入');

  let shareInfo: { encryptedData: string; iv: string };
  try {
    shareInfo = await withTimeout(Taro.getShareInfo({ shareTicket }) as Promise<{ encryptedData: string; iv: string }>, '微信群信息获取超时，请重新从群卡片进入');
  } catch (error) {
    clearCachedShareTicket();
    throw error;
  }
  const result = await withTimeout(request<{ user: UserProfile; groupOpenGid: string }>('/api/users/me/group-verify', 'POST', {
    encryptedData: shareInfo.encryptedData,
    iv: shareInfo.iv
  }), '微信群验证超时，请重试');
  saveUserProfile(result.user);
  return result;
};

export const bindWechatGroup = async () => {
  await refreshWechatSession();
  if (isWeb()) throw new Error('H5 预览无法绑定微信群，请使用微信小程序从目标群卡片进入');

  const shareTicket = getCurrentShareTicket();
  if (!shareTicket) throw new Error('请管理员从目标微信群的小程序卡片进入后再绑定');

  const shareInfo = await Taro.getShareInfo({ shareTicket });
  const result = await request<GroupBindingState>('/api/admin/group/bind', 'POST', {
    encryptedData: shareInfo.encryptedData,
    iv: shareInfo.iv
  });
  Taro.removeStorageSync(SHARE_TICKET_KEY);
  return result;
};

export const getGroupBindingState = () => request<GroupBindingState>('/api/admin/group/binding');

export const unbindWechatGroup = () => request<GroupBindingState>('/api/admin/group/unbind', 'POST');

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
