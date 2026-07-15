import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Button, Input, Textarea } from '@tarojs/components';
import Taro, { useLoad, usePullDownRefresh, useRouter, useShareAppMessage } from '@tarojs/taro';
import StatusPill from '@/components/StatusPill';
import { ensureAuthenticatedUser, getCurrentUser, hasAuthSession } from '@/services/auth';
import { dismissSquadApi, getSquadByIdApi, joinSquadApi, leaveSquadApi, updateNicknameApi } from '@/services/squadApi';
import { requestSquadStatusChangeSubscribe } from '@/services/subscription';
import { cacheCurrentShareTicket, ensureAuthorizedOrRedirect, getAccessState, verifyWechatGroupAccess } from '@/services/accessControl';
import { markPagesNeedRefresh } from '@/hooks/useFocusRefresh';
import { Squad } from '@/types/squad';
import styles from './index.module.scss';

const DetailPage: React.FC = () => {
  const router = useRouter();
  const squadId = Number(router.params.id || 1);
  const routeShareTicket = String(router.params.shareTicket || '');
  const [version, setVersion] = useState(0);
  const [squad, setSquad] = useState<Squad | undefined>();
  const shareSquadRef = useRef<Squad | undefined>();
  const user = getCurrentUser();
  const [nickname, setNickname] = useState(user.nickname === '未命名成员' ? '' : user.nickname);
  const [role, setRole] = useState('补位');
  const [note, setNote] = useState('');

  useLoad((options) => {
    Taro.showShareMenu({ withShareTicket: true }).catch(() => undefined);
    cacheCurrentShareTicket(String(options?.shareTicket || ''));
  });

  const verifyAccessAndLoadSquad = async () => {
    try {
      cacheCurrentShareTicket(routeShareTicket);
      if (!hasAuthSession()) {
        Taro.showToast({ title: '请先授权微信身份', icon: 'none' });
        return;
      }

      const state = await getAccessState();
      if (state.isDisabled) {
        Taro.showToast({ title: state.message, icon: 'none' });
        return;
      }
      if (state.needsGroupVerify) await verifyWechatGroupAccess(routeShareTicket);

      const nextSquad = await getSquadByIdApi(squadId);
      shareSquadRef.current = nextSquad;
      setSquad(nextSquad);
    } catch (error) {
      console.error('[Detail] load squad failed', error);
      Taro.showToast({ title: error instanceof Error ? error.message : '车队加载失败', icon: 'none' });
    }
  };

  useEffect(() => {
    verifyAccessAndLoadSquad();
  }, [squadId, version]);

  usePullDownRefresh(async () => {
    try {
      await verifyAccessAndLoadSquad();
    } finally {
      Taro.stopPullDownRefresh();
    }
  });

  const handleAuthorizeAndLoad = async () => {
    try {
      cacheCurrentShareTicket(routeShareTicket);
      await ensureAuthenticatedUser();
      await verifyAccessAndLoadSquad();
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '授权失败', icon: 'none' });
    }
  };

  useShareAppMessage((options) => {
    const shareSquad = shareSquadRef.current || squad;
    if (options.from === 'button') {
      return {
        title: shareSquad ? `${shareSquad.departTime} ${shareSquad.title}` : '港瓦夕阳红车队集合',
        path: `/pages/detail/index?id=${shareSquad?.id || squadId}`,
        imageUrl: 'https://api.viper333.cn/assets/share-card.jpg'
      };
    }

    return {
      title: '港瓦夕阳红车队集合',
      path: '/pages/index/index',
      imageUrl: 'https://api.viper333.cn/assets/share-card.jpg'
    };
  });

  if (!squad) {
    return (
      <View className={styles.page}>
        <View className={styles.headerCard}>
          <Text className={styles.title}>车队加载中</Text>
          <Text className={styles.meta}>如果你是从群里的车队卡片进入，请先授权微信身份，系统会自动完成微信群验证。</Text>
          <Button className={styles.primaryButton} onClick={handleAuthorizeAndLoad}>授权并加载车队</Button>
        </View>
      </View>
    );
  }

  const isCreator = Boolean(squad.isCreator) || squad.creatorOpenid === user.openid;
  const isJoined = Boolean(squad.isJoined) || squad.passengers.some((item) => item.openid === user.openid);
  const hasJoinedMembers = squad.passengers.length > 1;
  const restSlots = Math.max(squad.capacity - squad.passengers.length, 0);
  const forceRefresh = () => setVersion((value) => value + 1);

  const handleJoin = async () => {
    if (!await ensureAuthorizedOrRedirect()) return;
    try {
      const finalNickname = nickname.trim();
      if (!finalNickname) {
        Taro.showToast({ title: '请先填写昵称', icon: 'none' });
        return;
      }
      await requestSquadStatusChangeSubscribe();
      await updateNicknameApi(finalNickname);
      await joinSquadApi(squad.id, { role: role.trim() || '补位', note: note.trim() });
      setNickname(finalNickname);
      Taro.showToast({ title: '已加入车队', icon: 'success' });
      forceRefresh();
    } catch (error) {
      console.error('[Detail] join failed', error);
      Taro.showToast({ title: error instanceof Error ? error.message : '加入失败', icon: 'none' });
    }
  };

  const handleLeave = () => {
    Taro.showModal({
      title: '退出车队',
      content: '只有你本人可以退出自己的座位。',
      confirmText: '确认退出',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          if (!await ensureAuthorizedOrRedirect()) return;
          await leaveSquadApi(squad.id);
          markPagesNeedRefresh();
          Taro.showToast({ title: '已退出', icon: 'success' });
          forceRefresh();
        } catch (error) {
          console.error('[Detail] leave failed', error);
          Taro.showToast({ title: error instanceof Error ? error.message : '退出失败', icon: 'none' });
        }
      }
    });
  };

  const handleDismiss = () => {
    Taro.showModal({
      title: '解散车队',
      content: '仅发起人可解散车队。确认解散？',
      confirmText: '解散',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await dismissSquadApi(squad.id);
          markPagesNeedRefresh();
          Taro.showToast({ title: '已解散', icon: 'success' });
          setTimeout(() => Taro.redirectTo({ url: '/pages/index/index' }), 400);
        } catch (error) {
          console.error('[Detail] dismiss failed', error);
          Taro.showToast({ title: error instanceof Error ? error.message : '解散失败', icon: 'none' });
        }
      }
    });
  };

  const handleEdit = () => {
    if (hasJoinedMembers) {
      Taro.showToast({ title: '车队已有成员，不支持修改信息', icon: 'none' });
      return;
    }
    Taro.redirectTo({ url: `/pages/create/index?editId=${squad.id}` });
  };

  return (
    <View className={styles.page} data-version={version}>
      <View className={styles.headerCard}>
        <View className={styles.headerTop}>
          <View>
            <Text className={styles.title}>{squad.title}</Text>
            <View className={styles.tagRow}>
              {squad.tags.map((tag) => (
                <Text className={styles.tag} key={tag}>{tag}</Text>
              ))}
            </View>
          </View>
          <StatusPill status={squad.status} />
        </View>
        <Text className={styles.time}>{squad.departTime}</Text>
        <Text className={styles.meta}>发起人 / {squad.creatorName}</Text>
        <Text className={styles.note}>{squad.note}</Text>
        <View className={styles.capacityLine}>
          <Text className={styles.capacityText}>{squad.passengers.length}/{squad.capacity}</Text>
          <Text className={styles.restText}>{restSlots > 0 ? `差 ${restSlots} 人集结` : '已满员 · 准备开战'}</Text>
        </View>
      </View>

      {!isJoined && squad.status !== 'ready' && (
        <View className={styles.headerCard}>
          <Text className={styles.sectionTitle}>上车信息</Text>
          <Input className={styles.joinInput} placeholder='你的游戏昵称' value={nickname} onInput={(event) => setNickname(String(event.detail.value))} />
          <Input className={styles.joinInput} placeholder='位置/角色，例如 补位' value={role} onInput={(event) => setRole(String(event.detail.value))} />
          <Textarea className={styles.joinTextarea} placeholder='备注，例如 21:40 到' value={note} onInput={(event) => setNote(String(event.detail.value))} />
        </View>
      )}

      <View className={styles.sectionTitle}>成员名单</View>
      <View className={styles.crewCard}>
        {Array.from({ length: squad.capacity }).map((_, index) => {
          const passenger = squad.passengers[index];
          return (
            <View className={passenger ? styles.crewItem : styles.crewEmpty} key={index}>
              <Text className={styles.crewNo}>{String(index + 1).padStart(2, '0')}</Text>
              <View className={styles.crewInfo}>
                <Text className={styles.crewName}>{passenger ? passenger.nickname : '-- 空位 --'}</Text>
                <Text className={styles.crewRole}>{passenger ? `${passenger.role}${passenger.note ? ` · ${passenger.note}` : ''}` : '等待上车'}</Text>
              </View>
              {passenger?.isLeader && <Text className={styles.leaderTag}>队长</Text>}
            </View>
          );
        })}
      </View>

      <View className={styles.actionStack}>
        {!isJoined && squad.status !== 'ready' && <Button className={styles.primaryButton} onClick={handleJoin}>加入车队</Button>}
        {isCreator && (
          <Button
            className={`${styles.editButton} ${hasJoinedMembers ? styles.editButtonDisabled : ''}`}
            data-disabled={hasJoinedMembers}
            onClick={handleEdit}
          >
            编辑车队信息
          </Button>
        )}
        <Button className={styles.secondaryButton} openType='share'>分享车队</Button>
        {isJoined && !isCreator && <Button className={styles.dangerButton} onClick={handleLeave}>退出我的座位</Button>}
        {isCreator && <Button className={styles.dangerGhostButton} onClick={handleDismiss}>解散车队</Button>}
      </View>
    </View>
  );
};

export default DetailPage;
