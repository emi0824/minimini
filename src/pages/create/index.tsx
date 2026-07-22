import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Input, Textarea, Button, Picker } from '@tarojs/components';
import Taro, { useLoad, usePullDownRefresh, useRouter } from '@tarojs/taro';
import { getCurrentUser, hasAuthSession } from '@/services/auth';
import { createSquadApi, getNearbySquadsApi, getSquadByIdApi, updateSquadApi } from '@/services/squadApi';
import { requestCreateSquadSubscribes, SUBSCRIBE_TEMPLATE_IDS } from '@/services/subscription';
import { cacheCurrentShareTicket, ensureAuthorizedOrRedirect, getAccessState, verifyWechatGroupAccess } from '@/services/accessControl';
import { markPagesNeedRefresh } from '@/hooks/useFocusRefresh';
import { Squad, UserProfile } from '@/types/squad';
import styles from './index.module.scss';

const quickTags = ['接受分差', '不接受分差', '排位车', '匹配车', '晨练车', '必须准时', '不满散车'];
const quickTimes = ['18:00', '18:30', '19:00', '19:30', '20:00'];
const DEFAULT_SQUAD_NOTE = 'OOPZ语音，需要开麦，下车请提前@车上成员说明。';
const BEIJING_OFFSET = 8 * 60 * 60 * 1000;

const getBeijingDate = (offsetDays = 0) => {
  const date = new Date(Date.now() + BEIJING_OFFSET + offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
};

const formatDateLabel = (date: string) => date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1年$2月$3日');
const timeColumns = [
  Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0')),
  Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'))
];

const getTimePickerValue = (time: string) => {
  const [hour = '00', minute = '00'] = time.split(':');
  return [Number(hour), Number(minute)];
};

const getDepartAt = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`).getTime();
const isPastDepartTime = (date: string, time: string) => Boolean(date && time) && getDepartAt(date, time) <= Date.now();

const CreatePage: React.FC = () => {
  const router = useRouter();
  const editSquadId = Number(router.params.editId || 0);
  const isEditMode = Number.isInteger(editSquadId) && editSquadId > 0;
  const [profile, setProfile] = useState<UserProfile>(() => getCurrentUser());
  const nickname = profile.nickname === '未命名成员' ? '' : profile.nickname;
  const gameId = profile.gameId || '';
  const [departDate, setDepartDate] = useState(() => getBeijingDate());
  const [departTime, setDepartTime] = useState('');
  const [title, setTitle] = useState('');
  const [capacity, setCapacity] = useState(5);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [note, setNote] = useState(DEFAULT_SQUAD_NOTE);
  const [accessChecking, setAccessChecking] = useState(() => hasAuthSession());
  const [accessMessage, setAccessMessage] = useState('正在检查微信群准入状态...');
  const [editingSquadLoaded, setEditingSquadLoaded] = useState(!isEditMode);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const timePickerValue = useMemo(() => getTimePickerValue(departTime || '00:00'), [departTime]);

  useLoad((options) => {
    Taro.showShareMenu({ withShareTicket: true }).catch(() => undefined);
    cacheCurrentShareTicket(String(options?.shareTicket || ''));
  });

  usePullDownRefresh(() => {
    Taro.stopPullDownRefresh();
  });

  useEffect(() => {
    const verifyAccess = async () => {
      Taro.setNavigationBarTitle({ title: isEditMode ? '编辑车队' : '创建车队' });
      cacheCurrentShareTicket();
      if (!hasAuthSession()) {
        setAccessChecking(false);
        return;
      }

      try {
        const state = await getAccessState();
        setProfile(state.user);
        if (state.isDisabled) {
          setAccessMessage(state.message);
          setAccessChecking(false);
          return;
        }
        if (state.needsGroupVerify) {
          const result = await verifyWechatGroupAccess();
          setProfile(result.user);
        }
        if (isEditMode) {
          const squad = await getSquadByIdApi(editSquadId);
          if (!squad) throw new Error('车队不存在');
          if (!squad.isCreator) throw new Error('只有队长可以修改车队信息');
          if (squad.passengers.length > 1) throw new Error('车队已有成员，不支持修改信息');
          setDepartDate(squad.departDate || getBeijingDate());
          setDepartTime(squad.departTime.slice(0, 5));
          setTitle(squad.title);
          setCapacity(squad.capacity);
          setSelectedTags(squad.tags);
          setNote(squad.note);
          setEditingSquadLoaded(true);
        }
        setAccessChecking(false);
      } catch (error) {
        setAccessMessage(error instanceof Error ? error.message : '请从准入微信群卡片进入完成验证');
        setAccessChecking(false);
        if (isEditMode) {
          Taro.showToast({ title: error instanceof Error ? error.message : '车队信息加载失败', icon: 'none' });
          setTimeout(() => Taro.redirectTo({ url: `/pages/detail/index?id=${editSquadId}` }), 600);
        }
      }
    };

    verifyAccess();
  }, [editSquadId, isEditMode]);

  const toggleTag = (tag: string) => {
    setSelectedTags((items) => {
      if (items.includes(tag)) return items.filter((item) => item !== tag);
      if (items.length >= 6) {
        Taro.showToast({ title: '最多选择6个标签', icon: 'none' });
        return items;
      }
      return [...items, tag];
    });
  };

  const handleTimeChange = (value: number[]) => {
    const [hourIndex = 0, minuteIndex = 0] = value;
    const nextTime = `${timeColumns[0][hourIndex]}:${timeColumns[1][minuteIndex]}`;
    if (isPastDepartTime(departDate, nextTime)) {
      Taro.showToast({ title: '发车时间必须晚于当前时间', icon: 'none' });
      return;
    }
    setDepartTime(nextTime);
  };

  const handleQuickTime = (time: string) => {
    if (isPastDepartTime(departDate, time)) {
      Taro.showToast({ title: '该时间已过，请选择稍后的时间', icon: 'none' });
      return;
    }
    setDepartTime(time);
  };

  const handleSubmit = async () => {
    if (submitLockRef.current) return;
    const finalTitle = title.trim();
    const finalNote = note.trim() || '无备注';
    if (!nickname.trim()) {
      Taro.showToast({ title: '请先到我的页设置昵称', icon: 'none' });
      return;
    }
    if (!gameId.trim()) {
      Taro.showToast({ title: '请先到我的页填写游戏ID', icon: 'none' });
      return;
    }
    if (!departDate) {
      Taro.showToast({ title: '请选择发车日期', icon: 'none' });
      return;
    }
    if (!departTime) {
      Taro.showToast({ title: '请选择发车时间', icon: 'none' });
      return;
    }
    if (!finalTitle) {
      Taro.showToast({ title: '请填写车队名称', icon: 'none' });
      return;
    }
    if (isPastDepartTime(departDate, departTime)) {
      Taro.showToast({ title: '发车时间必须晚于当前时间', icon: 'none' });
      return;
    }
    if (finalTitle.length > 30) {
      Taro.showToast({ title: '车队名称不能超过30个字符', icon: 'none' });
      return;
    }
    if (finalNote.length > 120) {
      Taro.showToast({ title: '组队要求不能超过120个字符', icon: 'none' });
      return;
    }
    if (isEditMode && !editingSquadLoaded) {
      Taro.showToast({ title: accessChecking ? accessMessage : '车队信息尚未加载完成', icon: 'none' });
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    try {
      if (!await ensureAuthorizedOrRedirect()) return;
      let subscriptionTemplateIds: string[] = [];
      let hasDepartReminderSubscription = true;
      if (!isEditMode) {
        let nearby: Squad[] = [];
        let hasConfirmedCreation = false;
        try {
          nearby = await getNearbySquadsApi(departDate, departTime);
        } catch (error) {
          console.warn('[Create] nearby squad check skipped', error);
        }
        if (nearby.length > 0) {
          const nearbySummary = nearby
            .slice(0, 3)
            .map((item) => `${item.departTime} ${item.title}`)
            .join('、');
          const nearbyResult = await Taro.showModal({
            title: '创建车队',
            content: `前后30分钟内已有：${nearbySummary}${nearby.length > 3 ? `等${nearby.length}个车队` : ''}。是否仍然创建新车队？`,
            cancelText: '取消',
            confirmText: '创建'
          });
          if (!nearbyResult.confirm) return;
          hasConfirmedCreation = true;
        }
        if (!hasConfirmedCreation) {
          const confirmResult = await Taro.showModal({
            title: '确认创建车队',
            content: '请确认车队信息填写无误。有成员加入后，将无法修改车队信息。',
            cancelText: '取消',
            confirmText: '确认创建'
          });
          if (!confirmResult.confirm) return;
        }
        const subscriptionResult = await requestCreateSquadSubscribes();
        subscriptionTemplateIds = subscriptionResult.accepted;
        hasDepartReminderSubscription = subscriptionResult.accepted.includes(SUBSCRIBE_TEMPLATE_IDS.squadStatusChanged);
      }
      const input = {
        title: finalTitle,
        departDate,
        departTime,
        capacity,
        note: finalNote,
        tags: selectedTags,
        subscriptionTemplateIds
      };
      const squad = isEditMode
        ? await updateSquadApi(editSquadId, input)
        : await createSquadApi(input);
      console.info(isEditMode ? '[Create] updated squad' : '[Create] created squad', { id: squad.id });
      markPagesNeedRefresh();
      if (!isEditMode && !hasDepartReminderSubscription) {
        try {
          await Taro.showModal({
            title: '车队已创建',
            content: '你未授权发车消息提醒，将无法收到本车队的发车前提醒。',
            showCancel: false,
            confirmText: '知道了'
          });
        } catch (error) {
          console.warn('[Create] subscription notice skipped', error);
          Taro.showToast({ title: '车队已创建，未开启发车提醒', icon: 'none' });
        }
      } else {
        Taro.showToast({ title: isEditMode ? '车队已重新发布' : '车队已创建', icon: 'success' });
      }
      setTimeout(() => Taro.redirectTo({ url: isEditMode ? '/pages/index/index' : `/pages/detail/index?id=${squad.id}` }), 500);
    } catch (error) {
      console.error('[Create] create failed', error);
      Taro.showToast({ title: error instanceof Error ? error.message : (isEditMode ? '重新发布失败' : '创建失败'), icon: 'none' });
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <View className={styles.page}>
      <View className={styles.notice}>若修改时间/要求或解散车队，请及时在微信群通知车队成员。</View>
      <View className={styles.header}>
        <Text className={styles.kicker}>{isEditMode ? '更新车队信息' : '创建新的车队'}</Text>
        <Text className={styles.title}>{isEditMode ? '编辑车队' : '创建车队'}</Text>
        <Text className={styles.desc}>{isEditMode ? '修改后重新发布，将覆盖原有车队信息。' : '填写发车时间和组队要求，群友即可加入。'}</Text>
      </View>

      <View className={styles.formCard}>
        <View className={styles.compactGrid}>
          <View className={styles.field}>
            <Text className={styles.label}>发起人昵称<Text className={styles.requiredMark}>*</Text></Text>
            <View className={styles.readonlyInput}>{nickname || '未设置'}</View>
          </View>

          <View className={styles.field}>
            <Text className={styles.label}>游戏ID<Text className={styles.requiredMark}>*</Text></Text>
            <View className={styles.readonlyInput}>{gameId || '未填写'}</View>
          </View>
        </View>

        <View className={styles.compactGrid}>
          <View className={styles.field}>
            <Text className={styles.label}>发车日期<Text className={styles.requiredMark}>*</Text></Text>
            <Picker mode='date' value={departDate} start={getBeijingDate()} end={getBeijingDate(30)} onChange={(event) => setDepartDate(String(event.detail.value))}>
              <View className={styles.timePicker}>{formatDateLabel(departDate)}</View>
            </Picker>
          </View>

          <View className={styles.field}>
            <Text className={styles.label}>发车时间<Text className={styles.requiredMark}>*</Text></Text>
            <Picker mode='multiSelector' range={timeColumns} value={timePickerValue} onChange={(event) => handleTimeChange(event.detail.value as number[])}>
              <View className={styles.timePicker}>{departTime || '请选择'}</View>
            </Picker>
          </View>
        </View>
        <View className={styles.quickTimeList}>
          {quickTimes.map((time) => (
            <Text className={isPastDepartTime(departDate, time) ? styles.quickTimeDisabled : time === departTime ? styles.quickTimeActive : styles.quickTime} key={time} onClick={() => handleQuickTime(time)}>{time}</Text>
          ))}
        </View>

        <View className={styles.field}>
          <Text className={styles.label}>车队名称<Text className={styles.requiredMark}>*</Text></Text>
          <Input className={styles.input} maxlength={30} placeholder='填写排位段位要求/特殊要求等信息' placeholderClass={styles.placeholder} value={title} onInput={(event) => setTitle(String(event.detail.value))} />
        </View>

        <View className={styles.field}>
          <Text className={styles.label}>快捷标签（选填）</Text>
          <View className={styles.tagList}>
            {quickTags.map((tag) => (
              <Text className={selectedTags.includes(tag) ? styles.tagActive : styles.tag} key={tag} onClick={() => toggleTag(tag)}>{tag}</Text>
            ))}
          </View>
        </View>

        <View className={styles.field}>
          <Text className={styles.label}>目标人数<Text className={styles.requiredMark}>*</Text></Text>
          <View className={styles.counter}>
            <View className={styles.counterButton} onClick={() => setCapacity(Math.max(2, capacity - 1))}>-</View>
            <Text className={styles.capacity}>{capacity}</Text>
            <View className={styles.counterButton} onClick={() => setCapacity(Math.min(10, capacity + 1))}>+</View>
          </View>
          <Text className={styles.hint}>如有非群内成员，请按需减少队伍人数。</Text>
        </View>

        <View className={styles.field}>
          <Text className={styles.label}>组队要求（选填）</Text>
          <Textarea className={styles.textarea} maxlength={120} value={note} onInput={(event) => setNote(String(event.detail.value))} />
        </View>
      </View>

      <Button className={styles.submitButton} disabled={accessChecking || isSubmitting} onClick={handleSubmit}>{isSubmitting ? '正在提交...' : isEditMode ? '重新发布车队' : '确认创建车队'}</Button>
    </View>
  );
};

export default CreatePage;
