import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Button, Input, Textarea } from '@tarojs/components';
import Taro, { useLoad, usePullDownRefresh, useRouter, useShareAppMessage } from '@tarojs/taro';
import shareCardImage from '@/assets/share-card.jpg';
import shareCommonImage from '@/assets/share-common.jpg';
import StatusPill from '@/components/StatusPill';
import { ensureAuthenticatedUser, getCurrentUser, hasAuthSession } from '@/services/auth';
import { dismissSquadApi, getSquadByIdApi, joinSquadApi, leaveSquadApi, updatePassengerInfoApi } from '@/services/squadApi';
import { requestJoinSquadSubscribe } from '@/services/subscription';
import { cacheCurrentShareTicket, ensureAuthorizedOrRedirect, getAccessState, verifyWechatGroupAccess } from '@/services/accessControl';
import { markPagesNeedRefresh } from '@/hooks/useFocusRefresh';
import { Squad } from '@/types/squad';
import { formatMonthDay } from '@/utils/date';
import { formatSquadStatusText } from '@/utils/squadText';
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
  const [gameId, setGameId] = useState(user.gameId || '');
  const [role, setRole] = useState('');
  const [note, setNote] = useState('');
  const [isEditingMyInfo, setIsEditingMyInfo] = useState(false);
  const [myNickname, setMyNickname] = useState(user.nickname === '未命名成员' ? '' : user.nickname);
  const [myGameId, setMyGameId] = useState(user.gameId || '');
  const [myRole, setMyRole] = useState('');
  const [myNote, setMyNote] = useState('');

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
        imageUrl: shareCardImage
      };
    }

    return {
      title: '港瓦夕阳红车队集合',
      path: '/pages/index/index',
      imageUrl: shareCommonImage
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
  const myPassenger = squad.passengers.find((item) => item.isSelf || item.openid === user.openid);
  const hasJoinedMembers = squad.passengers.length > 1;
  const isDeparted = squad.status === 'departed';
  const forceRefresh = () => setVersion((value) => value + 1);

  const handleJoin = async () => {
    if (!await ensureAuthorizedOrRedirect()) return;
    try {
      const finalNickname = nickname.trim();
      if (!finalNickname) {
        Taro.showToast({ title: '请先填写昵称', icon: 'none' });
        return;
      }
      const finalGameId = gameId.trim();
      if (!finalGameId) {
        Taro.showToast({ title: '请填写游戏ID', icon: 'none' });
        return;
      }
      const subscriptionResult = await requestJoinSquadSubscribe();
      await joinSquadApi(squad.id, {
        nickname: finalNickname,
        gameId: finalGameId,
        role: role.trim(),
        note: note.trim(),
        subscriptionTemplateIds: subscriptionResult.accepted
      });
      setNickname(finalNickname);
      setGameId(finalGameId);
      if (subscriptionResult.accepted.length > 0) {
        Taro.showToast({ title: '已加入并订阅一次提醒', icon: 'success' });
      } else {
        try {
          await Taro.showModal({
            title: '已加入车队',
            content: '你未授权消息提醒，将无法收到本车队的发车前提醒。',
            showCancel: false,
            confirmText: '知道了'
          });
        } catch (error) {
          console.warn('[Detail] subscription notice skipped', error);
          Taro.showToast({ title: '已加入，未开启发车提醒', icon: 'none' });
        }
      }
      forceRefresh();
    } catch (error) {
      console.error('[Detail] join failed', error);
      Taro.showToast({ title: error instanceof Error ? error.message : '加入失败', icon: 'none' });
    }
  };

  const handleLeave = () => {
    Taro.showModal({
      title: '确认退出车队',
      content: '请在微信群内通知车队成员后再退出，以免影响其他成员组队。',
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
      title: '确认解散车队',
      content: '解散车队前，请在微信群内通知车队成员，以免影响其他成员组队。',
      confirmText: '确认解散',
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
    if (isDeparted) {
      Taro.showToast({ title: '已发车车队不支持修改', icon: 'none' });
      return;
    }
    if (hasJoinedMembers) {
      Taro.showToast({ title: '车队已有成员，不支持修改信息', icon: 'none' });
      return;
    }
    Taro.redirectTo({ url: `/pages/create/index?editId=${squad.id}` });
  };

  const handleCopySquad = async () => {
    try {
      await Taro.setClipboardData({ data: formatSquadStatusText(squad) });
      Taro.showToast({ title: '车况已复制', icon: 'success' });
    } catch (error) {
      console.error('[Detail] copy squad failed', error);
      Taro.showToast({ title: '复制失败，请重试', icon: 'none' });
    }
  };

  const handleOpenMyInfo = () => {
    setMyNickname(getCurrentUser().nickname === '未命名成员' ? '' : getCurrentUser().nickname);
    setMyGameId(getCurrentUser().gameId || myPassenger?.gameId || '');
    setMyRole(myPassenger?.role || '');
    setMyNote(myPassenger?.note || '');
    setIsEditingMyInfo(true);
  };

  const handleSaveMyInfo = async () => {
    const finalNickname = myNickname.trim();
    if (!finalNickname) {
      Taro.showToast({ title: '请填写昵称', icon: 'none' });
      return;
    }
    const finalGameId = myGameId.trim();
    if (!finalGameId) {
      Taro.showToast({ title: '请填写游戏ID', icon: 'none' });
      return;
    }

    try {
      const confirmResult = await Taro.showModal({
        title: '确认修改信息',
        content: '请确认以上修改车队成员已知悉，以免影响其他成员组队。',
        cancelText: '取消',
        confirmText: '确认修改'
      });
      if (!confirmResult.confirm) return;
      const result = await updatePassengerInfoApi(squad.id, { nickname: finalNickname, gameId: finalGameId, role: myRole.trim(), note: myNote.trim() });
      shareSquadRef.current = result.squad;
      setSquad(result.squad);
      setNickname(result.user.nickname);
      setGameId(result.user.gameId || '');
      setMyNickname(result.user.nickname);
      setMyGameId(result.user.gameId || '');
      setIsEditingMyInfo(false);
      markPagesNeedRefresh();
      Taro.showToast({ title: '上车信息已更新', icon: 'success' });
    } catch (error) {
      console.error('[Detail] update passenger info failed', error);
      Taro.showToast({ title: error instanceof Error ? error.message : '上车信息更新失败', icon: 'none' });
    }
  };

  return (
    <View className={styles.page} data-version={version}>
      <View className={styles.notice}>请准时上线并使用OOPZ语音，下车/迟到/解散等特殊情况请提前在微信群通知车队成员。</View>
      <View className={styles.headerCard}>
        <View className={styles.headerTop}>
          <View className={styles.headerMain}>
            <Text className={styles.title}>{squad.title}</Text>
            <View className={styles.tagRow}>
              {squad.tags.map((tag) => (
                <Text className={styles.tag} key={tag}>{tag}</Text>
              ))}
            </View>
          </View>
          <StatusPill status={squad.status} />
        </View>
        <View className={styles.departSchedule}>
          <Text className={styles.departDate}>{formatMonthDay(squad.departDate)}</Text>
          <Text className={styles.time}>{squad.departTime}</Text>
        </View>
        <Text className={styles.meta}>发起人 / {squad.creatorName}{squad.creatorGameId ? `（${squad.creatorGameId}）` : ''}</Text>
        <Text className={styles.note}>{squad.note}</Text>
        <View className={styles.capacityLine}>
          <Text className={styles.capacityLabel}>当前人数</Text>
          <Text className={styles.capacityText}>{squad.passengers.length}/{squad.capacity}</Text>
        </View>
      </View>

      <View className={styles.shareActions}>
        <Button className={styles.quickActionButton} onClick={handleCopySquad}>
          <Text className={styles.copyIcon}>▣</Text>
          <Text>复制车况</Text>
        </Button>
        <Button className={styles.quickActionButton} openType='share'>
          <Text className={styles.shareIcon}>↗</Text>
          <Text>分享车队</Text>
        </Button>
      </View>

      {!isJoined && !isDeparted && (
        <>
          <View className={styles.headerCard}>
            <Text className={styles.sectionTitle}>上车信息</Text>
            <View className={styles.inputGrid}>
              <View className={styles.inputField}>
                <Text className={styles.inputLabel}>称呼<Text className={styles.requiredMark}>*</Text></Text>
                <Input className={styles.joinInput} maxlength={20} placeholder='填写称呼' value={nickname} onInput={(event) => setNickname(String(event.detail.value))} />
              </View>
              <View className={styles.inputField}>
                <Text className={styles.inputLabel}>游戏ID<Text className={styles.requiredMark}>*</Text></Text>
                <Input className={styles.joinInput} maxlength={40} placeholder='填写游戏ID' value={gameId} onInput={(event) => setGameId(String(event.detail.value))} />
              </View>
            </View>
            <View className={styles.inputField}>
              <Text className={styles.inputLabel}>位置/角色（选填）</Text>
              <Input className={styles.joinInput} placeholder='填写位置或角色' value={role} onInput={(event) => setRole(String(event.detail.value))} />
            </View>
            <View className={styles.inputField}>
              <Text className={styles.inputLabel}>备注（选填）</Text>
              <Textarea className={styles.joinTextarea} maxlength={80} placeholder='填写特殊情况，若不确定是否能上车或不确定时间请在此说明，默认已确认且能够准时上车的成员优先' value={note} onInput={(event) => setNote(String(event.detail.value))} />
            </View>
          </View>
          <View className={styles.actionStackSingle}>
            <Button className={styles.primaryButton} onClick={handleJoin}>加入车队</Button>
          </View>
        </>
      )}

      <View className={`${styles.sectionTitle} ${styles.membersTitle}`}>成员名单</View>
      <View className={styles.crewCard}>
        {Array.from({ length: Math.max(squad.capacity, squad.passengers.length) }).map((_, index) => {
          const passenger = squad.passengers[index];
          const visibleRole = passenger?.role === '补位' ? '' : passenger?.role;
          const passengerMeta = [visibleRole, passenger?.note].filter(Boolean).join(' · ');
          const canEditPassenger = Boolean(passenger)
            && (passenger?.isSelf || passenger?.openid === user.openid)
            && !isDeparted
            && !isEditingMyInfo;
          return (
            <View className={passenger ? styles.crewItem : styles.crewEmpty} key={index}>
              <Text className={styles.crewNo}>{String(index + 1).padStart(2, '0')}</Text>
              <View className={styles.crewInfo}>
                <View className={styles.crewNameRow}>
                  <Text className={styles.crewName}>{passenger ? `${passenger.nickname}${passenger.gameId ? `（${passenger.gameId}）` : ''}` : '-- 空位 --'}</Text>
                </View>
                <Text className={styles.crewRole}>{passenger ? passengerMeta || '已上车' : '等待上车'}</Text>
              </View>
              {canEditPassenger && (
                <Button className={styles.editMyInfoButton} onClick={handleOpenMyInfo}>
                  <Text className={styles.editIcon}>✎</Text>
                  <Text>编辑</Text>
                </Button>
              )}
            </View>
          );
        })}
      </View>

      {isJoined && isEditingMyInfo && (
        <View className={styles.myInfoCard}>
          <Text className={styles.sectionTitle}>编辑我的上车信息</Text>
          <Text className={styles.formHint}>昵称为全局资料，保存后会同步更新到所有页面和车队。</Text>
          <View className={styles.inputGrid}>
            <View className={styles.inputField}>
              <Text className={styles.inputLabel}>称呼<Text className={styles.requiredMark}>*</Text></Text>
              <Input className={styles.joinInput} maxlength={20} placeholder='填写称呼' value={myNickname} onInput={(event) => setMyNickname(String(event.detail.value))} />
            </View>
            <View className={styles.inputField}>
              <Text className={styles.inputLabel}>游戏ID<Text className={styles.requiredMark}>*</Text></Text>
              <Input className={styles.joinInput} maxlength={40} placeholder='填写游戏ID' value={myGameId} onInput={(event) => setMyGameId(String(event.detail.value))} />
            </View>
          </View>
          <View className={styles.inputField}>
            <Text className={styles.inputLabel}>位置/角色（选填）</Text>
            <Input className={styles.joinInput} maxlength={16} placeholder='填写位置或角色' value={myRole} onInput={(event) => setMyRole(String(event.detail.value))} />
          </View>
          <View className={styles.inputField}>
            <Text className={styles.inputLabel}>备注（选填）</Text>
            <Textarea className={styles.joinTextarea} maxlength={80} placeholder='填写备注' value={myNote} onInput={(event) => setMyNote(String(event.detail.value))} />
          </View>
          <View className={styles.formActions}>
            <Button className={styles.primaryButton} onClick={handleSaveMyInfo}>保存修改</Button>
            <Button className={styles.secondaryButton} onClick={() => setIsEditingMyInfo(false)}>取消</Button>
          </View>
        </View>
      )}

      {isCreator && (
        <View className={isDeparted ? styles.actionStackSingle : styles.actionStack}>
          {!isDeparted && <Button className={styles.dangerGhostButton} onClick={handleDismiss}>解散车队</Button>}
          <Button
            className={`${styles.editButton} ${hasJoinedMembers || isDeparted ? styles.editButtonDisabled : ''}`}
            data-disabled={hasJoinedMembers || isDeparted}
            onClick={handleEdit}
          >
            编辑车队信息
          </Button>
        </View>
      )}
      {isJoined && !isCreator && !isDeparted && (
        <View className={styles.actionStackSingle}>
          <Button className={styles.dangerButton} onClick={handleLeave}>退出我的座位</Button>
        </View>
      )}
    </View>
  );
};

export default DetailPage;
