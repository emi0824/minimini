import React, { useEffect, useState } from 'react';
import { View, Text, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import SquadCard from '@/components/SquadCard';
import { useFocusRefresh } from '@/hooks/useFocusRefresh';
import { getSquadsApi } from '@/services/squadApi';
import { ensureAuthorizedOrRedirect } from '@/services/accessControl';
import { Squad } from '@/types/squad';
import styles from './index.module.scss';

const sortSquadsByDepartTime = (items: Squad[]) => (
  [...items].sort((left, right) => left.departTime.localeCompare(right.departTime))
);

const IndexPage: React.FC = () => {
  const { version, refresh } = useFocusRefresh();
  const [squads, setSquads] = useState<Squad[]>([]);

  useEffect(() => {
    getSquadsApi()
      .then((items) => setSquads(sortSquadsByDepartTime(items)))
      .catch((error) => {
        console.error('[Lobby] load squads failed', error);
        const message = error instanceof Error ? error.message : '车队加载失败';
        Taro.showToast({ title: message, icon: 'none' });
      });
  }, [version]);

  const totalPassengers = squads.reduce((sum, item) => sum + item.passengers.length, 0);
  const nextSquad = squads[0];

  const handleCreate = async () => {
    if (!await ensureAuthorizedOrRedirect()) return;
    console.info('[Lobby] navigate create');
    Taro.navigateTo({ url: '/pages/create/index' });
  };

  const handleCopy = () => {
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
      <View className={styles.hero}>
        <View className={styles.heroGrid} />
        <Text className={styles.eyebrow}>今日车队调度</Text>
        <Text className={styles.title}>港瓦夕阳红</Text>
        <Text className={styles.subtitle}>好友活动时间协调</Text>
        <View className={styles.statsRow}>
          <View className={styles.statItem}>
            <Text className={styles.statValue}>{squads.length}</Text>
            <Text className={styles.statLabel}>车队</Text>
          </View>
          <View className={styles.statItem}>
            <Text className={styles.statValue}>{totalPassengers}</Text>
            <Text className={styles.statLabel}>待命</Text>
          </View>
          <View className={styles.statItem}>
            <Text className={styles.statValue}>{nextSquad?.departTime || '--:--'}</Text>
            <Text className={styles.statLabel}>下一班</Text>
          </View>
        </View>
      </View>

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
          <SquadCard squad={squad} key={squad.id} onChanged={refresh} />
        ))}
        {squads.length === 0 && <Text className={styles.sectionDesc}>暂无车队，快来创建第一辆。</Text>}
      </View>
    </View>
  );
};

export default IndexPage;
