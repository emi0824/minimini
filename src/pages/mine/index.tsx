import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Button, Input } from '@tarojs/components';
import Taro, { useShareAppMessage } from '@tarojs/taro';
import { useFocusRefresh } from '@/hooks/useFocusRefresh';
import { ensureAuthenticatedUser, getCurrentUser, hasAuthSession } from '@/services/auth';
import { getSquadsApi, resetSquadsApi, updateNicknameApi } from '@/services/squadApi';
import { requestAllSquadSubscribes, SUBSCRIBE_TEMPLATE_IDS } from '@/services/subscription';
import {
  AccessState,
  bindWechatGroup,
  demoteAdminUser,
  disableUser,
  enableUser,
  getAccessState,
  getAdminUsers,
  getCachedAccessState,
  promoteUserToAdmin,
  verifyWechatGroupAccess
} from '@/services/accessControl';
import { Squad, UserProfile } from '@/types/squad';
import styles from './index.module.scss';

interface MinePageProps {
  active?: boolean;
}

const MinePage: React.FC<MinePageProps> = ({ active = true }) => {
  const { version, refresh } = useFocusRefresh();
  const [currentUser, setCurrentUser] = useState<UserProfile>(() => getCurrentUser());
  const [nickname, setNickname] = useState(currentUser.nickname === '未命名成员' ? '' : currentUser.nickname);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [isAuthorized, setIsAuthorized] = useState(() => hasAuthSession());
  const [accessState, setAccessState] = useState<AccessState | undefined>(() => (hasAuthSession() ? getCachedAccessState() : undefined));
  const [adminUsers, setAdminUsers] = useState<UserProfile[]>([]);
  const [disableReason, setDisableReason] = useState('不符合车队使用规则');
  const refreshSeqRef = useRef(0);

  const refreshAccessState = async () => {
    const refreshSeq = refreshSeqRef.current + 1;
    refreshSeqRef.current = refreshSeq;
    const isLatestRefresh = () => refreshSeqRef.current === refreshSeq;
    try {
      const state = await getAccessState();
      if (!isLatestRefresh()) return;

      setAccessState(state);
      setCurrentUser(state.user);
      setIsAuthorized(true);
      if (state.needsGroupVerify) {
        try {
          const result = await verifyWechatGroupAccess();
          if (!isLatestRefresh()) return;
          setCurrentUser(result.user);
          setAccessState({ ...state, user: result.user, isGroupVerified: true, needsGroupVerify: false, message: '权限正常' });
          const nextSquads = await getSquadsApi();
          if (isLatestRefresh()) setSquads(nextSquads);
        } catch (error) {
          if (isLatestRefresh()) setSquads([]);
        }
      } else if (!state.isDisabled) {
        const nextSquads = await getSquadsApi();
        if (isLatestRefresh()) setSquads(nextSquads);
      } else {
        setSquads([]);
      }
      if (state.isAdmin) {
        const nextAdminUsers = await getAdminUsers();
        if (isLatestRefresh()) setAdminUsers(nextAdminUsers);
      }
    } catch (error) {
      console.info('[Mine] access state skipped', error);
      if (isLatestRefresh() && !accessState) setIsAuthorized(false);
    }
  };

  useEffect(() => {
    if (!active) return;

    const hasSession = hasAuthSession();
    setIsAuthorized(hasSession);

    if (!hasSession) {
      setAccessState(undefined);
      return;
    }

    const cachedUser = getCurrentUser();
    setCurrentUser(cachedUser);
    setNickname(cachedUser.nickname === '未命名成员' ? '' : cachedUser.nickname);
    setAccessState(getCachedAccessState());
    refreshAccessState();
  }, [active, version]);

  const joined = squads.filter((item) => Boolean(item.isJoined) || item.passengers.some((passenger) => passenger.openid === currentUser.openid));
  const created = squads.filter((item) => Boolean(item.isCreator) || item.creatorOpenid === currentUser.openid);
  const accessBlocked = accessState?.isDisabled || accessState?.needsGroupVerify;
  const accessDescription = accessState?.isDisabled
    ? '你的使用权限已被管理员移除。如需恢复，请联系群管理员确认。'
    : '本小程序仅限指定车队群成员使用。请从群内分享的小程序卡片进入，完成成员验证后即可使用。';
  const canViewMine = isAuthorized && accessState && !accessBlocked;
  const accessOverlayTitle = !isAuthorized
    ? '需要授权微信身份'
    : !accessState
      ? '正在验证访问权限'
      : accessState.isDisabled
        ? '使用权限已移除'
        : '需要完成微信群验证';
  const accessOverlayDesc = !isAuthorized
    ? '请先授权微信身份。管理员授权后可直接进入；普通成员需从准入微信群卡片进入完成验证。'
    : !accessState
      ? '正在检查你的登录和准入状态...'
      : accessDescription;
  const accessOverlayButtonText = !isAuthorized ? '授权并继续' : '授权并验证';
  const subscribedIds = currentUser.subscribedTemplateIds || [];
  const subscribeTemplateIds = Object.values(SUBSCRIBE_TEMPLATE_IDS);
  const enabledMessageCount = subscribeTemplateIds.filter((id) => subscribedIds.includes(id)).length;
  const messageEnabled = enabledMessageCount === subscribeTemplateIds.length;
  const messagePartiallyEnabled = enabledMessageCount > 0 && !messageEnabled;
  const messageStatusText = messageEnabled
    ? '消息提醒：已开启'
    : messagePartiallyEnabled
      ? `消息提醒：部分开启 ${enabledMessageCount}/${subscribeTemplateIds.length}`
      : '消息提醒：未开启';
  const messageButtonText = messageEnabled ? '重新授权消息提醒' : messagePartiallyEnabled ? '继续授权消息提醒' : '授权消息提醒';
  const manageableUsers = adminUsers.filter((user) => user.openid !== currentUser.openid);
  const canManageAdminRole = accessState?.isRootAdmin === true;

  const openDetail = (id: number) => {
    Taro.navigateTo({ url: `/pages/detail/index?id=${id}` });
  };

  const handleAuthorizeAndCheck = async () => {
    try {
      await ensureAuthenticatedUser(nickname.trim() || currentUser.nickname);
      setIsAuthorized(true);
      await refreshAccessState();
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '授权失败', icon: 'none' });
    }
  };

  const handleSaveNickname = async () => {
    const finalNickname = nickname.trim();
    if (!finalNickname) {
      Taro.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    try {
      const nextUser = await updateNicknameApi(finalNickname);
      setCurrentUser(nextUser);
      setIsAuthorized(true);
      setNickname(nextUser.nickname === '未命名成员' ? '' : nextUser.nickname);
      Taro.showToast({ title: '授权成功，昵称已保存', icon: 'success' });
      refresh();
    } catch (error) {
      console.error('[Mine] update nickname failed', error);
      Taro.showToast({ title: error instanceof Error ? error.message : '保存失败', icon: 'none' });
    }
  };

  const handleBindGroup = async () => {
    try {
      await bindWechatGroup();
      await refreshAccessState();
      Taro.showToast({ title: '目标微信群已绑定', icon: 'success' });
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '绑定失败', icon: 'none' });
    }
  };

  const handlePromoteUser = (user: UserProfile) => {
    Taro.showModal({
      title: '设置管理员',
      content: `确认将 ${user.nickname} 设置为管理员？设置后该成员可管理成员权限和绑定准入微信群。`,
      confirmText: '设为管理员',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await promoteUserToAdmin(user.openid);
          setAdminUsers(await getAdminUsers());
          Taro.showToast({ title: '已设为管理员', icon: 'success' });
        } catch (error) {
          Taro.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' });
        }
      }
    });
  };

  const handleDemoteUser = (user: UserProfile) => {
    Taro.showModal({
      title: '取消管理员',
      content: `确认取消 ${user.nickname} 的管理员身份？取消后该成员将按普通成员准入规则使用。`,
      confirmText: '取消管理员',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await demoteAdminUser(user.openid);
          setAdminUsers(await getAdminUsers());
          Taro.showToast({ title: '已取消管理员', icon: 'success' });
        } catch (error) {
          Taro.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' });
        }
      }
    });
  };

  const handleToggleUser = (user: UserProfile) => {
    Taro.showModal({
      title: user.disabled ? '恢复成员权限' : '禁用成员权限',
      content: user.disabled ? '确认恢复该成员权限？' : '确认禁用该成员？禁用后该成员将无法创建、加入、退出车队。',
      confirmText: user.disabled ? '确认恢复' : '确认禁用',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          if (user.disabled) {
            await enableUser(user.openid);
          } else {
            await disableUser(user.openid, disableReason.trim() || '管理员禁用');
          }
          setAdminUsers(await getAdminUsers());
          Taro.showToast({ title: user.disabled ? '已恢复成员' : '已禁用成员', icon: 'success' });
        } catch (error) {
          Taro.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' });
        }
      }
    });
  };

  const handleSubscribeMessages = async () => {
    const result = await requestAllSquadSubscribes();
    const nextUser = getCurrentUser();
    setCurrentUser(nextUser);
    const nextCount = subscribeTemplateIds.filter((id) => (nextUser.subscribedTemplateIds || []).includes(id)).length;
    Taro.showToast({
      title: nextCount === subscribeTemplateIds.length
        ? '消息提醒已开启'
        : nextCount > 0
          ? `消息提醒部分开启 ${nextCount}/${subscribeTemplateIds.length}`
          : result.accepted.length > 0 ? '消息提醒部分开启' : '未开启消息提醒',
      icon: 'none'
    });
  };

  useShareAppMessage(() => ({
    title: '港瓦夕阳红车队准入验证',
    path: '/pages/index/index?tab=mine&from=group-bind'
  }));

  const handleReset = () => {
    Taro.showModal({
      title: '重置演示数据',
      content: '会恢复到初始演示车队，仅用于当前原型调试。',
      success: async (res) => {
        if (!res.confirm) return;
        await resetSquadsApi();
        Taro.showToast({ title: '已重置', icon: 'success' });
        refresh();
      }
    });
  };

  return (
    <View className={styles.page}>
      <View className={canViewMine ? styles.mineContent : styles.mineContentHidden}>
        <View className={styles.profileCard}>
        <Text className={styles.kicker}>我的活动档案</Text>
        <Text className={styles.nickname}>{currentUser.nickname}</Text>
        <Text className={styles.identity}>{isAuthorized ? '微信身份：已授权' : '微信身份：未授权 · 保存昵称时将绑定微信身份'}</Text>
        <Input className={styles.nicknameInput} placeholder='输入游戏昵称' value={nickname} onInput={(event) => setNickname(String(event.detail.value))} />
        <Button className={styles.editButton} onClick={handleSaveNickname}>{isAuthorized ? '保存昵称' : '授权并保存昵称'}</Button>
      </View>

      <View className={accessBlocked ? styles.accessBlockedCard : styles.section}>
        <Text className={styles.sectionTitle}>准入状态</Text>
        {accessBlocked ? (
          <View>
            {accessState?.isDisabled
              ? <Text className={styles.accessTitle}>使用权限已移除</Text>
              : <Text className={styles.accessTitle}>需要完成微信群验证</Text>}
            <Text className={styles.accessDesc}>{accessDescription}</Text>
            {accessState?.isDisabled && <Text className={styles.accessReason}>禁用原因：{accessState.user.disabledReason || '管理员禁用'}</Text>}
          </View>
        ) : (
          <Text className={styles.rowMeta}>{accessState?.message || '授权后可查看微信群准入状态'}</Text>
        )}
        {accessState?.isAdmin && <Text className={styles.rowMeta}>管理员权限：已开启</Text>}
      </View>

      {accessState?.isAdmin && (
        <View className={styles.section}>
          <Text className={styles.sectionTitle}>准入微信群绑定</Text>
          <Text className={styles.rowMeta}>扫码打开无法获取微信群 shareTicket。请先把小程序分享到目标微信群，再从群里的小程序卡片重新进入本页，最后点击绑定当前微信群。</Text>
          <View className={styles.guideSteps}>
            <Text className={styles.guideStep}>1. 点击分享到准入微信群</Text>
            <Text className={styles.guideStep}>2. 从目标微信群卡片重新进入</Text>
            <Text className={styles.guideStep}>3. 回到我的页点击绑定当前微信群</Text>
          </View>
          <Button className={styles.editButton} openType='share'>分享到准入微信群</Button>
          <Button className={styles.editButton} onClick={handleBindGroup}>绑定当前微信群</Button>
        </View>
      )}

      {accessState?.isAdmin && (
        <View className={styles.section}>
          <Text className={styles.sectionTitle}>成员权限管理</Text>
          <Input className={styles.nicknameInput} placeholder='禁用原因' value={disableReason} onInput={(event) => setDisableReason(String(event.detail.value))} />
          {manageableUsers.map((user) => (
            <View className={styles.row} key={user.openid}>
              <View>
                <Text className={styles.rowTitle}>{user.nickname}</Text>
                <Text className={styles.rowMeta}>{user.role === 'admin' ? '管理员' : '普通成员'} · 微信身份：已授权</Text>
                <Text className={styles.rowMeta}>{user.disabled ? `已禁用 · ${user.disabledReason || '无原因'}` : '可使用'}</Text>
              </View>
              <View className={styles.rowActions}>
                {canManageAdminRole && (user.role === 'admin'
                  ? <Text className={styles.rowAction} onClick={() => handleDemoteUser(user)}>取消管理员</Text>
                  : <Text className={styles.rowAction} onClick={() => handlePromoteUser(user)}>设为管理员</Text>)}
                <Text className={styles.rowAction} onClick={() => handleToggleUser(user)}>{user.disabled ? '恢复' : '禁用'}</Text>
              </View>
            </View>
          ))}
          {manageableUsers.length === 0 && <Text className={styles.rowMeta}>暂无可管理成员</Text>}
        </View>
      )}

      <View className={styles.section}>
        <Text className={styles.sectionTitle}>我加入的车队</Text>
        {joined.map((item) => (
          <View className={styles.row} key={item.id} onClick={() => openDetail(item.id)}>
            <View>
              <Text className={styles.rowTitle}>{item.departTime} {item.title}</Text>
              <Text className={styles.rowMeta}>{item.passengers.length}/{item.capacity} · {item.creatorName} 发起</Text>
            </View>
            <Text className={styles.rowAction}>查看</Text>
          </View>
        ))}
        {joined.length === 0 && <Text className={styles.rowMeta}>暂未加入任何车队</Text>}
      </View>

      <View className={styles.section}>
        <Text className={styles.sectionTitle}>我创建的车队</Text>
        {created.map((item) => (
          <View className={styles.row} key={item.id} onClick={() => openDetail(item.id)}>
            <View>
              <Text className={styles.rowTitle}>{item.departTime} {item.title}</Text>
              <Text className={styles.rowMeta}>仅发起人可解散车队</Text>
            </View>
            <Text className={styles.rowAction}>管理</Text>
          </View>
        ))}
        {created.length === 0 && <Text className={styles.rowMeta}>暂未创建任何车队</Text>}
      </View>

      <View className={styles.section}>
        <View className={styles.messageHeader}>
          <Text className={styles.sectionTitle}>消息提醒</Text>
          <Text className={messageEnabled ? styles.messageStatusOn : messagePartiallyEnabled ? styles.messageStatusPartial : styles.messageStatusOff}>{messageStatusText}</Text>
        </View>
        <Text className={styles.rowMeta}>开启后你将收到：你创建的车队有成员加入/退出、你加入的车队被解散、车队状态发生变化。</Text>
        <Button className={styles.editButton} onClick={handleSubscribeMessages}>{messageButtonText}</Button>
      </View>

        <Button className={styles.editButton} onClick={handleReset}>重置演示数据</Button>
      </View>

      {!canViewMine && (
        <View className={styles.accessOverlay}>
          <View className={styles.accessModal}>
            <Text className={styles.accessTitle}>{accessOverlayTitle}</Text>
            <Text className={styles.accessDesc}>{accessOverlayDesc}</Text>
            {(!isAuthorized || accessState?.needsGroupVerify) && <Button className={styles.editButton} onClick={handleAuthorizeAndCheck}>{accessOverlayButtonText}</Button>}
          </View>
        </View>
      )}
    </View>
  );
};

export default MinePage;
