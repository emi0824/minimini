import Taro from '@tarojs/taro';
import { API_BASE_URL } from '@/config/api';

type RequestMethod = 'GET' | 'POST' | 'DELETE' | 'PUT';

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  message?: string;
}

interface RequestOptions {
  skipAuth?: boolean;
}

const TOKEN_KEY = 'gangwa_auth_token';
const showRequestLoading = () => {
  Taro.showLoading({ title: '加载中', mask: true });
};

const hideRequestLoading = () => {
  Taro.hideLoading();
};

const getRequestErrorMessage = (error: unknown) => {
  const errMsg = error && typeof error === 'object' && 'errMsg' in error && typeof error.errMsg === 'string' ? error.errMsg : '';
  if (errMsg.includes('url not in domain list') || errMsg.includes('domain list')) return '后端域名未配置到微信合法域名';
  if (errMsg.includes('fail') && API_BASE_URL.startsWith('http://')) return '真机预览暂不支持 HTTP IP 后端';
  if (error instanceof Error && error.message) return error.message;
  if (errMsg) return errMsg;
  return '网络请求失败';
};

const getRequestErrorLog = (error: unknown) => ({
  message: getRequestErrorMessage(error),
  statusCode: error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined,
  errMsg: error && typeof error === 'object' && 'errMsg' in error ? error.errMsg : undefined
});

export const request = async <T>(path: string, method: RequestMethod = 'GET', data?: unknown, options: RequestOptions = {}): Promise<T> => {
  const url = `${API_BASE_URL}${path}`;
  const token = Taro.getStorageSync<string>(TOKEN_KEY);
  showRequestLoading();
  try {
    const response = await Taro.request<ApiResponse<T>>({
      url,
      method,
      data,
      header: {
        'content-type': 'application/json',
        ...(token && !options.skipAuth ? { Authorization: `Bearer ${token}` } : {})
      }
    });

    if (response.statusCode < 200 || response.statusCode >= 300 || !response.data?.ok) {
      throw new Error(response.data?.message || `请求失败（${response.statusCode}）`);
    }

    return response.data.data as T;
  } catch (error) {
    const message = getRequestErrorMessage(error);
    console.error('[Request] failed', { url, method, ...getRequestErrorLog(error) });
    throw new Error(message);
  } finally {
    hideRequestLoading();
  }
};
