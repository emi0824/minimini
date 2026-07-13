import React, { useMemo, useState } from 'react';
import { View, Text, Input, Textarea, Button, Picker } from '@tarojs/components';
import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { getCurrentUser } from '@/services/auth';
import { createSquadApi } from '@/services/squadApi';
import { requestSquadMemberChangeSubscribe } from '@/services/subscription';
import { ensureAuthorizedOrRedirect } from '@/services/accessControl';
import { markPagesNeedRefresh } from '@/hooks/useFocusRefresh';
import styles from './index.module.scss';

const quickTags = ['接受分差', '不接受分差', '排位车', '匹配车', '晨练车', '破冰专属'];
const quickTimes = ['20:00', '20:30', '21:00', '21:30', '22:00', '22:30'];
const timeColumns = [
  Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0')),
  Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'))
];

const getTimePickerValue = (time: string) => {
  const [hour = '00', minute = '00'] = time.split(':');
  return [Number(hour), Number(minute)];
};

const CreatePage: React.FC = () => {
  const user = getCurrentUser();
  const nickname = user.nickname === '未命名成员' ? '' : user.nickname;
  const [departTime, setDepartTime] = useState('21:30');
  const [title, setTitle] = useState('排位复健车');
  const [capacity, setCapacity] = useState(5);
  const [selectedTags, setSelectedTags] = useState<string[]>(['接受分差']);
  const [note, setNote] = useState('缺辅助，语音开黑，别鸽。');
  const timePickerValue = useMemo(() => getTimePickerValue(departTime), [departTime]);

  usePullDownRefresh(() => {
    Taro.stopPullDownRefresh();
  });

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
    if (!departTime || !finalTitle) {
      Taro.showToast({ title: '请填写发车时间和车队名称', icon: 'none' });
      return;
    }

    if (!await ensureAuthorizedOrRedirect()) return;

    try {
      await requestSquadMemberChangeSubscribe();
      const squad = await createSquadApi({
        title: finalTitle,
        departTime,
        capacity,
        note: note.trim() || '无备注',
        tags: selectedTags
      });
      console.info('[Create] created squad', { id: squad.id });
      markPagesNeedRefresh();
      Taro.showToast({ title: '车队已创建', icon: 'success' });
      setTimeout(() => Taro.redirectTo({ url: `/pages/detail/index?id=${squad.id}` }), 500);
    } catch (error) {
      console.error('[Create] create failed', error);
      Taro.showToast({ title: error instanceof Error ? error.message : '创建失败', icon: 'none' });
    }
  };

  return (
    <View className={styles.page}>
      <View className={styles.header}>
        <Text className={styles.kicker}>创建新的车队</Text>
        <Text className={styles.title}>创建车队</Text>
        <Text className={styles.desc}>填写发车时间和组队要求，群友即可加入。</Text>
      </View>

      <View className={styles.formCard}>
        <View className={styles.field}>
          <Text className={styles.label}>发起人代号</Text>
          <View className={styles.readonlyInput}>{nickname || '请先到我的页设置昵称'}</View>
        </View>

        <View className={styles.field}>
          <Text className={styles.label}>发车时间</Text>
          <Picker mode='multiSelector' range={timeColumns} value={timePickerValue} onChange={(event) => handleTimeChange(event.detail.value as number[])}>
            <View className={styles.timePicker}>{departTime}</View>
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

      <Button className={styles.submitButton} onClick={handleSubmit}>确认创建车队</Button>
    </View>
  );
};

export default CreatePage;
