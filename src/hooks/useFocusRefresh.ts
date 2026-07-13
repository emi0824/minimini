import { useCallback, useRef, useState } from 'react';
import Taro, { useDidShow } from '@tarojs/taro';

const REFRESH_VERSION_KEY = 'gangwa_refresh_version';

const getRefreshVersion = () => Number(Taro.getStorageSync<number>(REFRESH_VERSION_KEY) || 0);

export const markPagesNeedRefresh = () => {
  Taro.setStorageSync(REFRESH_VERSION_KEY, getRefreshVersion() + 1);
};

export const useFocusRefresh = () => {
  const [version, setVersion] = useState(0);
  const didShowOnce = useRef(false);
  const lastRefreshVersion = useRef(getRefreshVersion());
  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useDidShow(() => {
    const currentRefreshVersion = getRefreshVersion();
    if (!didShowOnce.current) {
      didShowOnce.current = true;
      lastRefreshVersion.current = currentRefreshVersion;
      return;
    }

    if (currentRefreshVersion === lastRefreshVersion.current) return;
    lastRefreshVersion.current = currentRefreshVersion;
    refresh();
  });

  return { version, refresh };
};
