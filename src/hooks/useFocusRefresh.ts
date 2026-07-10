import { useCallback, useState } from 'react';
import { useDidShow } from '@tarojs/taro';

export const useFocusRefresh = () => {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useDidShow(refresh);

  return { version, refresh };
};
