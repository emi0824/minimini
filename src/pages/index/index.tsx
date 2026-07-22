import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Button } from '@tarojs/components';
import Taro, { useLoad, usePullDownRefresh, useRouter, useShareAppMessage } from '@tarojs/taro';
import shareCommonImage from '@/assets/share-common.jpg';
import SquadCard from '@/components/SquadCard';
import MinePage from '@/pages/mine';
import { useFocusRefresh } from '@/hooks/useFocusRefresh';
import { getHomeApi } from '@/services/squadApi';
import { ensureAuthenticatedUser, getCurrentUser, hasAuthSession } from '@/services/auth';
import { cacheCurrentShareTicket, getAccessState, getCachedAccessState, verifyWechatGroupAccess } from '@/services/accessControl';
import { Squad } from '@/types/squad';
import { sortSquadsSmart } from '@/utils/squad';
import styles from './index.module.scss';

type DateFilter = 'all' | 'today' | 'tomorrow';
const BEIJING_OFFSET = 8 * 60 * 60 * 1000;
const getBeijingDate = (offsetDays = 0) => new Date(Date.now() + BEIJING_OFFSET + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

type AccessViewStatus = 'checking' | 'allowed' | 'needAuth' | 'needGroup' | 'disabled';
type HomeTab = 'lobby' | 'mine';
const HOME_CACHE_TTL = 5 * 60 * 1000;

interface HomeSquadCache {
  openid: string;
  cachedAt: number;
  squads: Squad[];
}

const getHomeCacheKey = (openid: string) => `gangwa_home_squads_${openid}`;

const getCachedHomeSquads = () => {
  if (!hasAuthSession()) return [];
  const accessState = getCachedAccessState();
  if (accessState.isDisabled || accessState.needsGroupVerify) return [];
  const user = getCurrentUser();
  const cached = Taro.getStorageSync<HomeSquadCache>(getHomeCacheKey(user.openid));
  if (!cached || cached.openid !== user.openid || !Array.isArray(cached.squads)) return [];
  if (Date.now() - Number(cached.cachedAt || 0) > HOME_CACHE_TTL) return [];
  return sortSquadsSmart(cached.squads);
};

const saveHomeSquads = (squads: Squad[]) => {
  const user = getCurrentUser();
  Taro.setStorageSync(getHomeCacheKey(user.openid), { openid: user.openid, cachedAt: Date.now(), squads });
};

const clearHomeSquads = () => {
  const user = getCurrentUser();
  Taro.removeStorageSync(getHomeCacheKey(user.openid));
};

const IndexPage: React.FC = () => {
  const router = useRouter();
  const startsOnMine = router.params.tab === 'mine';
  const [activeTab, setActiveTab] = useState<HomeTab>(() => (startsOnMine ? 'mine' : 'lobby'));
  const [hasOpenedMine, setHasOpenedMine] = useState(startsOnMine);
  const [mineRefreshSignal, setMineRefreshSignal] = useState(0);
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const { version } = useFocusRefresh();
  const [squads, setSquads] = useState<Squad[]>(getCachedHomeSquads);
  const [homeRefreshing, setHomeRefreshing] = useState(() => {
    if (!hasAuthSession()) return false;
    const cachedState = getCachedAccessState();
    return !cachedState.isDisabled && !cachedState.needsGroupVerify;
  });
  const [accessStatus, setAccessStatus] = useState<AccessViewStatus>(() => {
    if (!hasAuthSession()) return 'needAuth';
    const cachedState = getCachedAccessState();
    if (cachedState.isDisabled) return 'disabled';
    return cachedState.needsGroupVerify ? 'needGroup' : 'allowed';
  });
  const [accessMessage, setAccessMessage] = useState(() => {
    if (!hasAuthSession()) return '请先授权微信身份。管理员授权后可直接进入；普通成员需从准入微信群卡片进入完成验证。';
    const cachedState = getCachedAccessState();
    if (cachedState.isDisabled) return '你的使用权限已被管理员移除。如需恢复，请联系群管理员确认。';
    return cachedState.needsGroupVerify ? '本小程序仅限指定车队群成员使用。请从群内分享的小程序卡片进入，完成成员验证后即可使用。' : '权限正常';
  });

  useShareAppMessage(() => ({
    title: '港瓦夕阳红车队集合',
    path: '/pages/index/index',
    imageUrl: shareCommonImage
  }));
  const accessStatusRef = useRef(accessStatus);
  const loadSeqRef = useRef(0);

  useLoad((options) => {
    Taro.showShareMenu({ withShareTicket: true }).catch(() => undefined);
    cacheCurrentShareTicket(String(options?.shareTicket || ''));
  });

  useEffect(() => {
    accessStatusRef.current = accessStatus;
  }, [accessStatus]);

  const loadHome = async (isLatestLoad: () => boolean) => {
    const result = await getHomeApi();
    if (!isLatestLoad()) return;
    const items = sortSquadsSmart(result.squads);
    setSquads(items);
    saveHomeSquads(items);
    setAccessStatus('allowed');
  };

  const checkAccessAndLoad = async () => {
    cacheCurrentShareTicket();
    const loadSeq = loadSeqRef.current + 1;
    loadSeqRef.current = loadSeq;
    const isLatestLoad = () => loadSeqRef.current === loadSeq;
    const wasAllowed = accessStatusRef.current === 'allowed';
    setHomeRefreshing(true);
    if (!wasAllowed) {
      setAccessStatus('checking');
      setAccessMessage('正在检查微信群准入状态...');
    }
    try {
      if (!hasAuthSession()) {
        if (!wasAllowed) setSquads([]);
        setAccessStatus('needAuth');
        setAccessMessage('请先授权微信身份，随后从准入微信群卡片进入完成成员验证。');
        return;
      }

      const cachedState = getCachedAccessState();
      if (!cachedState.isDisabled && !cachedState.needsGroupVerify) {
        await loadHome(isLatestLoad);
        return;
      }

      const state = await getAccessState();
      if (!isLatestLoad()) return;
      if (state.isDisabled) {
        if (!wasAllowed) setSquads([]);
        setAccessStatus('disabled');
        setAccessMessage('你的使用权限已被管理员移除。如需恢复，请联系群管理员确认。');
        return;
      }

      if (state.needsGroupVerify) {
        try {
          await verifyWechatGroupAccess();
          await loadHome(isLatestLoad);
        } catch (error) {
          if (!wasAllowed) setSquads([]);
          setAccessStatus('needGroup');
          setAccessMessage('本小程序仅限指定车队群成员使用。请从群内分享的小程序卡片进入，完成成员验证后即可使用。');
        }
        return;
      }

      await loadHome(isLatestLoad);
    } catch (error) {
      console.error('[Lobby] access check failed', error);
      if (!isLatestLoad()) return;
      const message = error instanceof Error ? error.message : '首页刷新失败';
      if (message.includes('微信群') || message.includes('群内')) {
        clearHomeSquads();
        setSquads([]);
        setAccessStatus('needGroup');
        setAccessMessage('本小程序仅限指定车队群成员使用。请从群内分享的小程序卡片进入，完成成员验证后即可使用。');
      } else if (message.includes('禁用') || message.includes('权限已被')) {
        clearHomeSquads();
        setSquads([]);
        setAccessStatus('disabled');
        setAccessMessage(message);
      } else if (message.includes('请先登录') || message.includes('登录已失效') || message.includes('登录已过期')) {
        clearHomeSquads();
        setSquads([]);
        setAccessStatus('needAuth');
        setAccessMessage('登录已失效，请重新授权微信身份。');
      } else if (wasAllowed) {
        setAccessStatus('allowed');
        Taro.showToast({ title: '网络较慢，已显示最近车队信息', icon: 'none' });
      } else {
        clearHomeSquads();
        setSquads([]);
        setAccessStatus('needAuth');
        setAccessMessage(message || '请先授权微信身份');
      }
    } finally {
      if (isLatestLoad()) setHomeRefreshing(false);
    }
  };

  useEffect(() => {
    checkAccessAndLoad();
  }, [version]);

  const handleRefresh = async () => {
    if (activeTab === 'mine') {
      setMineRefreshSignal((value) => value + 1);
      Taro.showToast({ title: '已刷新', icon: 'success' });
      return;
    }

    await checkAccessAndLoad();
    Taro.showToast({ title: '已刷新', icon: 'success' });
  };

  usePullDownRefresh(async () => {
    try {
      await handleRefresh();
    } finally {
      Taro.stopPullDownRefresh();
    }
  });

  const canUseLobby = accessStatus === 'allowed';
  const today = getBeijingDate();
  const tomorrow = getBeijingDate(1);
  const visibleSquads = sortSquadsSmart(squads.filter((item) => {
    const matchesDate = dateFilter === 'all'
      || (dateFilter === 'today' && item.departDate === today)
      || (dateFilter === 'tomorrow' && item.departDate === tomorrow);
    return matchesDate;
  }));
  const accessTitle = accessStatus === 'checking'
    ? '正在验证访问权限'
    : accessStatus === 'disabled'
      ? '使用权限已移除'
      : accessStatus === 'needAuth'
        ? '需要授权微信身份'
        : '需要完成微信群验证';
  const accessButtonText = accessStatus === 'needAuth' ? '授权并继续' : '授权并验证';

  const handleAuthorizeAndVerify = async () => {
    try {
      await ensureAuthenticatedUser();
      await checkAccessAndLoad();
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '授权失败', icon: 'none' });
    }
  };

  const handleCreate = async () => {
    if (!canUseLobby) {
      Taro.showToast({ title: '请先完成授权或微信群验证', icon: 'none' });
      return;
    }
    console.info('[Lobby] navigate create');
    Taro.navigateTo({ url: '/pages/create/index' });
  };

  const handleTabChange = (tab: HomeTab) => {
    if (tab === 'mine') setHasOpenedMine(true);
    setActiveTab(tab);
  };

  return (
    <View className={styles.page} data-version={version}>
      <View className={activeTab === 'lobby' ? styles.tabPaneActive : styles.tabPaneHidden}>
        <View className={styles.notice}>请准时上线并使用OOPZ语音，下车/迟到/解散等特殊情况请提前在微信群通知车队成员。</View>

        <View className={styles.hero}>
          <View className={styles.heroGrid} />
          <Text className={styles.eyebrow}>近期车队概览</Text>
          <View className={styles.titleRow}>
            <Text className={styles.title}>港瓦夕阳红</Text>
            <Text className={styles.statValue}>{canUseLobby ? squads.length : '--'}</Text>
          </View>
          <View className={styles.subtitleRow}>
            <Text className={styles.subtitle}>预约上车组队大厅</Text>
            <Text className={styles.statLabel}>已有车队</Text>
          </View>
        </View>

        <View className={canUseLobby ? styles.lobbyContent : styles.lobbyContentHidden}>
          <View className={styles.commandPanel}>
            <Button className={styles.primaryAction} onClick={handleCreate}>创建车队</Button>
            <Button className={styles.secondaryAction} onClick={handleRefresh}>刷新</Button>
          </View>

          <View className={styles.filterPanel}>
            <View className={styles.dateFilterGroup}>
              <View className={dateFilter === 'all' ? styles.dateFilterActive : styles.dateFilter} onClick={() => setDateFilter('all')}>
                <Text>全部</Text>
              </View>
              <View className={dateFilter === 'today' ? styles.dateFilterActive : styles.dateFilter} onClick={() => setDateFilter('today')}>
                <Text>今日</Text>
              </View>
              <View className={dateFilter === 'tomorrow' ? styles.dateFilterActive : styles.dateFilter} onClick={() => setDateFilter('tomorrow')}>
                <Text>明日</Text>
              </View>
            </View>
          </View>

          <View className={styles.list}>
            {homeRefreshing && <Text className={styles.sectionDesc}>{squads.length > 0 ? '正在同步最新车队...' : '正在加载车队...'}</Text>}
            {visibleSquads.map((squad) => (
              <SquadCard squad={squad} key={squad.id} />
            ))}
            {!homeRefreshing && visibleSquads.length === 0 && <Text className={styles.sectionDesc}>{squads.length === 0 ? '暂无车队，快来创建第一辆。' : '当前日期暂无车队。'}</Text>}
          </View>
        </View>

        {!canUseLobby && (
          <View className={styles.accessOverlay}>
            <View className={styles.accessModal}>
              <Text className={styles.accessTitle}>{accessTitle}</Text>
              <Text className={styles.accessDesc}>{accessMessage}</Text>
              {accessStatus !== 'checking' && accessStatus !== 'disabled' && (
                <Button className={styles.primaryAction} onClick={handleAuthorizeAndVerify}>{accessButtonText}</Button>
              )}
            </View>
          </View>
        )}
      </View>

      <View className={activeTab === 'mine' ? styles.tabPaneActive : styles.tabPaneHidden}>
        {hasOpenedMine && <MinePage active={activeTab === 'mine'} refreshSignal={mineRefreshSignal} />}
      </View>

      <View className={styles.customTabBar}>
        <View className={activeTab === 'lobby' ? styles.customTabActive : styles.customTab} onClick={() => handleTabChange('lobby')}>
          <Text>大厅</Text>
        </View>
        <View className={activeTab === 'mine' ? styles.customTabActive : styles.customTab} onClick={() => handleTabChange('mine')}>
          <Text>我的</Text>
        </View>
      </View>
    </View>
  );
};

export default IndexPage;
