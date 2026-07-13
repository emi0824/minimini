import React, { useEffect } from 'react';
import Taro, { useDidShow, useDidHide } from '@tarojs/taro';
// 全局样式
import './app.scss';

const SHARE_TICKET_KEY = 'gangwa_latest_share_ticket';

function App(props) {
  // 可以使用所有的 React Hooks
  useEffect(() => {
    Taro.showShareMenu({ withShareTicket: true }).catch(() => undefined);
  }, []);

  // 对应 onShow
  useDidShow(() => {
    const enterOptions = Taro.getEnterOptionsSync?.();
    if (enterOptions?.shareTicket) {
      Taro.setStorageSync(SHARE_TICKET_KEY, enterOptions.shareTicket);
    }
  });

  // 对应 onHide
  useDidHide(() => {});

  return props.children;
}

export default App;
