import React from 'react';
import { Text } from '@tarojs/components';
import classnames from 'classnames';
import { SquadStatus } from '@/types/squad';
import styles from './index.module.scss';

interface StatusPillProps {
  status: SquadStatus;
}

const statusMap: Record<SquadStatus, string> = {
  recruiting: '招募中',
  ready: '已满员',
  departed: '已发车',
  cancelled: '已取消'
};

const StatusPill: React.FC<StatusPillProps> = ({ status }) => {
  return (
    <Text className={classnames(styles.pill, styles[status])}>
      {statusMap[status]}
    </Text>
  );
};

export default StatusPill;
