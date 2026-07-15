import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Input, Textarea, Button, Picker } from '@tarojs/components';
import Taro, { useLoad, usePullDownRefresh, useRouter } from '@tarojs/taro';
import { getCurrentUser, hasAuthSession } from '@/services/auth';
import { createSquadApi, getSquadByIdApi, updateSquadApi } from '@/services/squadApi';
import { requestSquadMemberChangeSubscribe } from '@/services/subscription';
import { cacheCurrentShareTicket, ensureAuthorizedOrRedirect, getAccessState, verifyWechatGroupAccess } from '@/services/accessControl';
import { markPagesNeedRefresh } from '@/hooks/useFocusRefresh';
import styles from './index.module.scss';

const quickTags = ['接受分差', '不接受分差', '排位车', '匹配车', '晨练车', '破冰专属'];
const quickTimes = ['20:00', '20:30', '21:00', '21:30', '22:00', '22:30'];
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

const CreatePage: React.FC = () => {
  const router = useRouter();
  const editSquadId = Number(router.params.editId || 0);
  const isEditMode = Number.isInteger(editSquadId) && editSquadId > 0;
  const user = getCurrentUser();
  const nickname = user.nickname === '未命名成员' ? '' : user.nickname;
  const [departDate, setDepartDate] = useState(() => getBeijingDate());
  const [departTime, setDepartTime] = useState('21:30');
  const [title, setTitle] = useState('排位复健车');
  const [capacity, setCapacity] = useState(5);
  const [selectedTags, setSelectedTags] = useState<string[]>(['接受分差']);
  const [note, setNote] = useState('缺辅助，语音开黑，别鸽。');
  const [accessChecking, setAccessChecking] = useState(() => hasAuthSession());
  const [accessMessage, setAccessMessage] = useState('正在检查微信群准入状态...');
  const [editingSquadLoaded, setEditingSquadLoaded] = useState(!isEditMode);
  const timePickerValue = useMemo(() => getTimePickerValue(departTime), [departTime]);

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
        if (state.isDisabled) {
          setAccessMessage(state.message);
          setAccessChecking(false);
          return;
        }
        if (state.needsGroupVerify) await verifyWechatGroupAccess();
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
    setSelectedTags((items) => (
      items.includes(tag) ? items.filter((item) => item !== tag) : [...items, tag]
    ));
  };

  const handleTimeChange = (value: number[]) => {
    const [hourIndex = 0, minuteIndex = 0] = value;
    setDepartTime(`${timeColumns[0][hourIndex]}:${timeColumns[1][minuteIndex]}`);
  };

  const handleSubmit = async () => {
    const finalTitle = title.trim();
    if (!nickname) {
      Taro.showToast({ title: '请先到我的页设置昵称', icon: 'none' });
      return;
    }
    if (!departDate || !departTime || !finalTitle) {
      Taro.showToast({ title: '请填写发车日期、时间和车队名称', icon: 'none' });
      return;
    }
    if (isEditMode && !editingSquadLoaded) {
      Taro.showToast({ title: accessChecking ? accessMessage : '车队信息尚未加载完成', icon: 'none' });
      return;
    }

    if (!await ensureAuthorizedOrRedirect()) return;

    try {
      if (!isEditMode) await requestSquadMemberChangeSubscribe();
      const input = {
        title: finalTitle,
        departDate,
        departTime,
        capacity,
        note: note.trim() || '无备注',
        tags: selectedTags
      };
      const squad = isEditMode
        ? await updateSquadApi(editSquadId, input)
        : await createSquadApi(input);
      console.info(isEditMode ? '[Create] updated squad' : '[Create] created squad', { id: squad.id });
      markPagesNeedRefresh();
      Taro.showToast({ title: isEditMode ? '车队已重新发布' : '车队已创建', icon: 'success' });
      setTimeout(() => Taro.redirectTo({ url: `/pages/detail/index?id=${squad.id}` }), 500);
    } catch (error) {
      console.error('[Create] create failed', error);
      Taro.showToast({ title: error instanceof Error ? error.message : (isEditMode ? '重新发布失败' : '创建失败'), icon: 'none' });
    }
  };

  return (
    <View className={styles.page}>
      <View className={styles.header}>
        <Text className={styles.kicker}>{isEditMode ? '更新车队信息' : '创建新的车队'}</Text>
        <Text className={styles.title}>{isEditMode ? '编辑车队' : '创建车队'}</Text>
        <Text className={styles.desc}>{isEditMode ? '修改后重新发布，将覆盖原有车队信息。' : '填写发车时间和组队要求，群友即可加入。'}</Text>
      </View>

      <View className={styles.formCard}>
        <View className={styles.field}>
          <Text className={styles.label}>发起人代号</Text>
          <View className={styles.readonlyInput}>{nickname || '请先到我的页设置昵称'}</View>
        </View>

        <View className={styles.field}>
          <Text className={styles.label}>发车日期（北京时间）</Text>
          <Picker mode='date' value={departDate} start={getBeijingDate()} end={getBeijingDate(30)} onChange={(event) => setDepartDate(String(event.detail.value))}>
            <View className={styles.timePicker}>{formatDateLabel(departDate)}</View>
          </Picker>
        </View>

        <View className={styles.field}>
          <Text className={styles.label}>发车时间（北京时间）</Text>
          <Picker mode='multiSelector' range={timeColumns} value={timePickerValue} onChange={(event) => handleTimeChange(event.detail.value as number[])}>
            <View className={styles.timePicker}>{formatDateLabel(departDate)} {departTime}</View>
          </Picker>
          <View className={styles.quickTimeList}>
            {quickTimes.map((time) => (
              <Text className={time === departTime ? styles.quickTimeActive : styles.quickTime} key={time} onClick={() => setDepartTime(time)}>{time}</Text>
            ))}
          </View>
        </View>

        <View className={styles.field}>
          <Text className={styles.label}>车队名称</Text>
          <Input className={styles.input} placeholder='例如 排位复健车' placeholderClass={styles.placeholder} value={title} onInput={(event) => setTitle(String(event.detail.value))} />
        </View>

        <View className={styles.field}>
          <Text className={styles.label}>快捷标签</Text>
          <View className={styles.tagList}>
            {quickTags.map((tag) => (
              <Text className={selectedTags.includes(tag) ? styles.tagActive : styles.tag} key={tag} onClick={() => toggleTag(tag)}>{tag}</Text>
            ))}
          </View>
        </View>

        <View className={styles.field}>
          <Text className={styles.label}>队伍人数</Text>
          <View className={styles.counter}>
            <View className={styles.counterButton} onClick={() => setCapacity(Math.max(2, capacity - 1))}>-</View>
            <Text className={styles.capacity}>{capacity}</Text>
            <View className={styles.counterButton} onClick={() => setCapacity(Math.min(10, capacity + 1))}>+</View>
          </View>
        </View>

        <View className={styles.field}>
          <Text className={styles.label}>作战备注</Text>
          <Textarea className={styles.textarea} placeholder='缺辅助 / 语音开黑 / 别鸽' placeholderClass={styles.placeholder} value={note} onInput={(event) => setNote(String(event.detail.value))} />
        </View>
      </View>

      <Button className={styles.submitButton} onClick={handleSubmit}>{isEditMode ? '重新发布车队' : '确认创建车队'}</Button>
    </View>
  );
};

export default CreatePage;
