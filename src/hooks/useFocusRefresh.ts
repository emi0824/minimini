import { useCallback, useRef, useState } from 'react';
import { useDidShow } from '@tarojs/taro';

export const useFocusRefresh = () => {
  const [version, setVersion] = useState(0);
  const didShowOnce = useRef(false);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useDidShow(() => {
    if (!didShowOnce.current) {
      didShowOnce.current = true;
      return;
    }
    refresh();
  });

  return { version, refresh };
};
