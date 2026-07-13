import React from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { Squad } from '@/types/squad';
import { getCurrentUser } from '@/services/auth';
import { joinSquadApi } from '@/services/squadApi';
import { requestSquadStatusChangeSubscribe } from '@/services/subscription';
import { ensureAuthorizedOrRedirect } from '@/services/accessControl';
import { markPagesNeedRefresh } from '@/hooks/useFocusRefresh';
import StatusPill from '@/components/StatusPill';
import styles from './index.module.scss';

interface SquadCardProps {
  squad: Squad;
}

const SquadCard: React.FC<SquadCardProps> = ({ squad }) => {
  const user = getCurrentUser();
  const joinedCount = squad.passengers.length;
  const restCount = Math.max(squad.capacity - joinedCount, 0);
  const percent = Math.min((joinedCount / squad.capacity) * 100, 100);
  const isJoined = Boolean(squad.isJoined) || squad.passengers.some((item) => item.openid === user.openid);
  const isCreator = Boolean(squad.isCreator) || squad.creatorOpenid === user.openid;
  const statusTags = [
    squad.status === 'ready' ? '已满员' : `差${restCount}人`,
    ...(isJoined ? ['我已加入'] : []),
    ...(isCreator ? ['我创建的'] : [])
  ];

  const handleDetail = () => {
    console.info('[SquadCard] open detail', squad.id);
    Taro.navigateTo({ url: `/pages/detail/index?id=${squad.id}` });
  };

  const handleJoin = async () => {
    if (!await ensureAuthorizedOrRedirect()) return;
    try {
      await requestSquadStatusChangeSubscribe();
      await joinSquadApi(squad.id, { role: '补位' });
      markPagesNeedRefresh();
      Taro.showToast({ title: '已加入车队', icon: 'success' });
      setTimeout(() => Taro.navigateTo({ url: `/pages/detail/index?id=${squad.id}` }), 350);
    } catch (error) {
      console.error('[SquadCard] join failed', error);
      Taro.showToast({ title: error instanceof Error ? error.message : '加入失败', icon: 'none' });
    }
  };

  return (
    <View className={styles.card}>
      <View className={styles.accent} />
      <View className={styles.header}>
        <View className={styles.timeBlock}>
          <Text className={styles.time}>{squad.departTime}</Text>
          <Text className={styles.code}>{squad.code}</Text>
        </View>
        <StatusPill status={squad.status} />
      </View>

      <Text className={styles.title}>{squad.title}</Text>
      <Text className={styles.creator}>发起人 / {squad.creatorName}</Text>

      <View className={styles.statusTags}>
        {statusTags.map((tag) => (
          <Text className={tag === '已满员' ? styles.statusTagFull : styles.statusTag} key={tag}>{tag}</Text>
        ))}
      </View>

      <View className={styles.progressRow}>
        <View className={styles.progressTrack}>
          <View className={styles.progressFill} style={{ width: `${percent}%` }} />
        </View>
        <Text className={styles.count}>{joinedCount}/{squad.capacity}</Text>
      </View>

      <Text className={styles.statusText}>{squad.status === 'ready' ? '已满员 · 准备开战' : `差 ${restCount} 人集结`}</Text>
      <Text className={styles.note}>{squad.note}</Text>

      <View className={styles.tags}>
        {squad.tags.map((tag) => (
          <Text className={styles.tag} key={tag}>{tag}</Text>
        ))}
      </View>

      <View className={styles.footer}>
        <Text className={styles.passengers}>乘员：{squad.passengers.map((item) => item.nickname).join(' / ')}</Text>
        <View className={styles.actions}>
          <View className={styles.secondaryButton} onClick={handleDetail}>详情</View>
          <View className={styles.primaryButton} onClick={isJoined || squad.status === 'ready' ? handleDetail : handleJoin}>
            {isJoined ? '已加入' : squad.status === 'ready' ? '已满员' : '加入车队'}
          </View>
        </View>
      </View>
    </View>
  );
};

export default SquadCard;
