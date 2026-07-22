import React from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { Squad } from '@/types/squad';
import { getCurrentUser } from '@/services/auth';
import { formatMonthDay } from '@/utils/date';
import styles from './index.module.scss';

interface SquadCardProps {
  squad: Squad;
}

const SquadCard: React.FC<SquadCardProps> = ({ squad }) => {
  const user = getCurrentUser();
  const joinedCount = squad.passengers.length;
  const percent = Math.min((joinedCount / squad.capacity) * 100, 100);
  const isJoined = Boolean(squad.isJoined) || squad.passengers.some((item) => item.openid === user.openid);
  const isCreator = Boolean(squad.isCreator) || squad.creatorOpenid === user.openid;
  const seatList = Array.from({ length: Math.max(squad.capacity, joinedCount) }, (_, index) => squad.passengers[index]);
  const isDeparted = squad.status === 'departed';
  const cardClassName = [
    styles.card,
    isJoined ? styles.cardJoined : '',
    squad.status === 'recruiting' ? styles.cardRecruiting : '',
    squad.status === 'ready' ? styles.cardReady : '',
    isDeparted ? styles.cardDeparted : ''
  ].filter(Boolean).join(' ');

  const handleDetail = () => {
    console.info('[SquadCard] open detail', squad.id);
    Taro.navigateTo({ url: `/pages/detail/index?id=${squad.id}` });
  };

  const stopCardClick = (event: { stopPropagation?: () => void }) => {
    event.stopPropagation?.();
  };

  return (
    <View className={cardClassName} onClick={handleDetail}>
      <View className={styles.accent} />
      <View className={styles.header}>
        <Text className={styles.title}>{squad.title}</Text>
        <Text className={styles.time}>{squad.departTime}</Text>
      </View>

      <View className={styles.metaRow}>
        <View className={styles.tagRow}>
          {squad.tags.map((tag) => (
            <Text className={styles.tag} key={tag}>{tag}</Text>
          ))}
        </View>
        <Text className={styles.departDate}>{formatMonthDay(squad.departDate)}</Text>
      </View>

      <Text className={styles.creator}>发起人 / {squad.creatorName}{squad.creatorGameId ? `（${squad.creatorGameId}）` : ''}</Text>
      {squad.note && squad.note !== '无备注' && <Text className={styles.note}>{squad.note}</Text>}

      <View className={styles.progressRow}>
        <View className={styles.progressTrack}>
          <View className={styles.progressFill} style={{ width: `${percent}%` }} />
        </View>
        <Text className={styles.passengerCount}>{joinedCount}/{squad.capacity}</Text>
      </View>

      <View className={styles.passengerPanel}>
        <View className={styles.passengerGrid}>
          {seatList.map((passenger, index) => (
            <View className={passenger ? styles.seatFilled : styles.seatEmpty} key={`${squad.id}-${index}`}>
              <Text className={styles.seatName}>{passenger?.nickname || '待加入'}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className={styles.footer}>
        <View className={styles.badgeRow}>
          {squad.status !== 'ready' && <Text className={isDeparted ? styles.statusBadgeDeparted : styles.statusBadge}>{isDeparted ? '已发车' : '招募中'}</Text>}
          {isCreator && <Text className={styles.ownerBadge}>我创建的</Text>}
        </View>
        <View className={styles.primaryButton} onClick={(event) => {
          stopCardClick(event);
          handleDetail();
        }}>
          {isJoined ? '已加入' : isDeparted ? '查看' : '查看并加入'}
        </View>
      </View>
    </View>
  );
};

export default SquadCard;
