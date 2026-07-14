import React from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { Squad } from '@/types/squad';
import { getCurrentUser } from '@/services/auth';
import { joinSquadApi, updateNicknameApi } from '@/services/squadApi';
import { requestSquadStatusChangeSubscribe } from '@/services/subscription';
import { ensureAuthorizedOrRedirect } from '@/services/accessControl';
import { markPagesNeedRefresh } from '@/hooks/useFocusRefresh';
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
  const seatList = Array.from({ length: squad.capacity }, (_, index) => squad.passengers[index]);

  const handleDetail = () => {
    console.info('[SquadCard] open detail', squad.id);
    Taro.navigateTo({ url: `/pages/detail/index?id=${squad.id}` });
  };

  const stopCardClick = (event: { stopPropagation?: () => void }) => {
    event.stopPropagation?.();
  };

  const handleJoin = async () => {
    if (!await ensureAuthorizedOrRedirect()) return;
    try {
      await requestSquadStatusChangeSubscribe();
      if (user.nickname && user.nickname !== '未命名成员') await updateNicknameApi(user.nickname);
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
    <View className={isJoined ? styles.cardJoined : styles.card} onClick={handleDetail}>
      <View className={styles.accent} />
      <View className={styles.header}>
        <Text className={styles.title}>{squad.title}</Text>
        <Text className={styles.time}>{squad.departTime}</Text>
      </View>

      <View className={styles.tagRow}>
        {squad.tags.map((tag) => (
          <Text className={styles.tag} key={tag}>{tag}</Text>
        ))}
      </View>

      <Text className={styles.creator}>发起人 / {squad.creatorName}</Text>
      <Text className={styles.note}>{squad.note}</Text>

      <View className={styles.progressRow}>
        <View className={styles.progressTrack}>
          <View className={styles.progressFill} style={{ width: `${percent}%` }} />
        </View>
        <Text className={styles.passengerCount}>{joinedCount}/{squad.capacity}</Text>
      </View>

      <Text className={styles.statusText}>{squad.status === 'ready' ? '已满员' : `差 ${restCount} 人集结`}</Text>

      <View className={styles.passengerPanel}>
        <View className={styles.passengerGrid}>
          {seatList.map((passenger, index) => (
            <View className={passenger ? styles.seatFilled : styles.seatEmpty} key={`${squad.id}-${index}`}>
              <Text className={styles.seatName}>{passenger?.nickname || '待补位'}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className={styles.footer}>
        <View className={styles.badgeRow}>
          <Text className={squad.status === 'ready' ? styles.statusBadgeFull : styles.statusBadge}>{squad.status === 'ready' ? '已满员' : '招募中'}</Text>
          {isCreator && <Text className={styles.ownerBadge}>我创建的</Text>}
        </View>
        <View className={styles.primaryButton} onClick={(event) => {
          stopCardClick(event);
          if (isJoined || squad.status === 'ready') {
            handleDetail();
            return;
          }
          handleJoin();
        }}>
          {isJoined ? '已加入' : squad.status === 'ready' ? '已满员' : '加入'}
        </View>
      </View>
    </View>
  );
};

export default SquadCard;
