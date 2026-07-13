import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Button } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import SquadCard from '@/components/SquadCard';
import MinePage from '@/pages/mine';
import { useFocusRefresh } from '@/hooks/useFocusRefresh';
import { getSquadsApi } from '@/services/squadApi';
import { ensureAuthenticatedUser, hasAuthSession } from '@/services/auth';
import { getAccessState, getCachedAccessState, verifyWechatGroupAccess } from '@/services/accessControl';
import { Squad } from '@/types/squad';
import styles from './index.module.scss';

const sortSquadsByDepartTime = (items: Squad[]) => (
  [...items].sort((left, right) => left.departTime.localeCompare(right.departTime))
);

type AccessViewStatus = 'checking' | 'allowed' | 'needAuth' | 'needGroup' | 'disabled';
type HomeTab = 'lobby' | 'mine';

const IndexPage: React.FC = () => {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<HomeTab>(() => (router.params.tab === 'mine' ? 'mine' : 'lobby'));
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
  const accessStatusRef = useRef(accessStatus);
  const loadSeqRef = useRef(0);

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

  const totalPassengers = squads.reduce((sum, item) => sum + item.passengers.length, 0);
  const nextSquad = squads[0];
  const canUseLobby = accessStatus === 'allowed';
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

  const handleCopy = () => {
    if (!canUseLobby) {
      Taro.showToast({ title: '请先完成授权或微信群验证', icon: 'none' });
      return;
    }

    const content = squads.map((item, index) => {
      const rest = Math.max(item.capacity - item.passengers.length, 0);
      return `${index + 1}. ${item.departTime} ${item.title}\n发起人：${item.creatorName}\n人数：${item.passengers.length}/${item.capacity}${rest > 0 ? `，差 ${rest} 人` : '，已满员'}\n备注：${item.note}`;
    }).join('\n\n');

    Taro.setClipboardData({
      data: `【港瓦夕阳红 · 今日车队】\n\n${content || '暂无车队'}`,
      success: () => Taro.showToast({ title: '战报已复制', icon: 'success' })
    });
  };

  return (
    <View className={styles.page} data-version={version}>
      <View className={activeTab === 'lobby' ? styles.tabPaneActive : styles.tabPaneHidden}>
        <View className={styles.hero}>
          <View className={styles.heroGrid} />
          <Text className={styles.eyebrow}>今日车队调度</Text>
          <Text className={styles.title}>港瓦夕阳红</Text>
          <Text className={styles.subtitle}>好友活动时间协调</Text>
          <View className={styles.statsRow}>
            <View className={styles.statItem}>
              <Text className={styles.statValue}>{canUseLobby ? squads.length : '--'}</Text>
              <Text className={styles.statLabel}>车队</Text>
            </View>
            <View className={styles.statItem}>
              <Text className={styles.statValue}>{canUseLobby ? totalPassengers : '--'}</Text>
              <Text className={styles.statLabel}>待命</Text>
            </View>
            <View className={styles.statItem}>
              <Text className={styles.statValue}>{canUseLobby ? nextSquad?.departTime || '--:--' : '--:--'}</Text>
              <Text className={styles.statLabel}>下一班</Text>
            </View>
          </View>
        </View>

        <View className={canUseLobby ? styles.lobbyContent : styles.lobbyContentHidden}>
          <View className={styles.commandPanel}>
            <Button className={styles.primaryAction} onClick={handleCreate}>创建车队</Button>
            <Button className={styles.secondaryAction} onClick={handleCopy}>复制战报</Button>
          </View>

          <View className={styles.sectionHeader}>
            <View>
              <Text className={styles.sectionTitle}>今日集结</Text>
              <Text className={styles.sectionDesc}>按发车时间排序，满员即准备开战</Text>
            </View>
            <Text className={styles.liveBadge}>进行中</Text>
          </View>

          <View className={styles.list}>
            {squads.map((squad) => (
              <SquadCard squad={squad} key={squad.id} />
            ))}
            {squads.length === 0 && <Text className={styles.sectionDesc}>暂无车队，快来创建第一辆。</Text>}
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
        <MinePage active={activeTab === 'mine'} />
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
