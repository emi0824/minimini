import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Button } from '@tarojs/components';
import Taro, { useLoad, usePullDownRefresh, useRouter, useShareAppMessage } from '@tarojs/taro';
import SquadCard from '@/components/SquadCard';
import MinePage from '@/pages/mine';
import { useFocusRefresh } from '@/hooks/useFocusRefresh';
import { getSquadsApi } from '@/services/squadApi';
import { ensureAuthenticatedUser, hasAuthSession } from '@/services/auth';
import { cacheCurrentShareTicket, getAccessState, getCachedAccessState, verifyWechatGroupAccess } from '@/services/accessControl';
import { Squad } from '@/types/squad';
import styles from './index.module.scss';

type DateFilter = 'all' | 'today' | 'tomorrow';
const BEIJING_OFFSET = 8 * 60 * 60 * 1000;
const getBeijingDate = (offsetDays = 0) => new Date(Date.now() + BEIJING_OFFSET + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const sortSquadsByDepartTime = (items: Squad[]) => (
  [...items].sort((left, right) => `${left.departDate || ''} ${left.departTime}`.localeCompare(`${right.departDate || ''} ${right.departTime}`))
);

type AccessViewStatus = 'checking' | 'allowed' | 'needAuth' | 'needGroup' | 'disabled';
type HomeTab = 'lobby' | 'mine';

const IndexPage: React.FC = () => {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<HomeTab>(() => (router.params.tab === 'mine' ? 'mine' : 'lobby'));
  const [mineRefreshSignal, setMineRefreshSignal] = useState(0);
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);
  const { version } = useFocusRefresh();
  const [squads, setSquads] = useState<Squad[]>([]);
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
    imageUrl: 'https://api.viper333.cn/assets/share-card.jpg'
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

  const loadSquads = async (isLatestLoad: () => boolean) => {
    const items = await getSquadsApi();
    if (!isLatestLoad()) return;
    setSquads(sortSquadsByDepartTime(items));
    setAccessStatus('allowed');
  };

  const checkAccessAndLoad = async () => {
    cacheCurrentShareTicket();
    const loadSeq = loadSeqRef.current + 1;
    loadSeqRef.current = loadSeq;
    const isLatestLoad = () => loadSeqRef.current === loadSeq;
    const wasAllowed = accessStatusRef.current === 'allowed';
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
          await loadSquads(isLatestLoad);
        } catch (error) {
          if (!wasAllowed) setSquads([]);
          setAccessStatus('needGroup');
          setAccessMessage('本小程序仅限指定车队群成员使用。请从群内分享的小程序卡片进入，完成成员验证后即可使用。');
        }
        return;
      }

      await loadSquads(isLatestLoad);
    } catch (error) {
      console.error('[Lobby] access check failed', error);
      if (!isLatestLoad()) return;
      if (!wasAllowed) setSquads([]);
      setAccessStatus('needAuth');
      setAccessMessage(error instanceof Error ? error.message : '请先授权微信身份');
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
  const visibleSquads = squads.filter((item) => {
    const matchesDate = dateFilter === 'all'
      || (dateFilter === 'today' && item.departDate === today)
      || (dateFilter === 'tomorrow' && item.departDate === tomorrow);
    const matchesAvailable = !showAvailableOnly || (item.passengers.length < item.capacity && item.status !== 'ready');
    return matchesDate && matchesAvailable;
  });
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

  return (
    <View className={styles.page} data-version={version}>
      <View className={activeTab === 'lobby' ? styles.tabPaneActive : styles.tabPaneHidden}>
        <View className={styles.hero}>
          <View className={styles.heroGrid} />
          <Text className={styles.eyebrow}>今日车队调度</Text>
          <View className={styles.titleRow}>
            <Text className={styles.title}>港瓦夕阳红</Text>
            <View className={styles.heroStat}>
              <Text className={styles.statValue}>{canUseLobby ? squads.length : '--'}</Text>
              <Text className={styles.statLabel}>已有车队</Text>
            </View>
          </View>
          <Text className={styles.subtitle}>好友活动时间协调</Text>
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
            <View className={showAvailableOnly ? styles.filterButtonActive : styles.filterButton} onClick={() => setShowAvailableOnly((value) => !value)}>
              <Text className={showAvailableOnly ? styles.filterCheckActive : styles.filterCheck}>{showAvailableOnly ? '✓' : ''}</Text>
              <Text>未满员</Text>
            </View>
          </View>

          <View className={styles.list}>
            {visibleSquads.map((squad) => (
              <SquadCard squad={squad} key={squad.id} />
            ))}
            {visibleSquads.length === 0 && <Text className={styles.sectionDesc}>{squads.length === 0 ? '暂无车队，快来创建第一辆。' : '暂无未满员车队。'}</Text>}
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
        <MinePage active={activeTab === 'mine'} refreshSignal={mineRefreshSignal} />
      </View>

      <View className={styles.customTabBar}>
        <View className={activeTab === 'lobby' ? styles.customTabActive : styles.customTab} onClick={() => setActiveTab('lobby')}>
          <Text>大厅</Text>
        </View>
        <View className={activeTab === 'mine' ? styles.customTabActive : styles.customTab} onClick={() => setActiveTab('mine')}>
          <Text>我的</Text>
        </View>
      </View>
    </View>
  );
};

export default IndexPage;
