import { Squad, UserProfile } from '@/types/squad';

export const currentUser: UserProfile = {
  openid: 'mock_user_001',
  nickname: '老王',
  joinedSquadIds: [1],
  createdSquadIds: [3]
};

export const squads: Squad[] = [
  {
    id: 1,
    title: '排位复健车',
    code: '排位集结',
    creatorOpenid: 'mock_user_002',
    creatorName: '老张',
    departTime: '21:30',
    capacity: 5,
    note: '缺辅助，语音开黑，别鸽。',
    tags: ['接受分差', '排位车'],
    status: 'recruiting',
    passengers: [
      { id: 1, openid: 'mock_user_002', nickname: '老张', role: '队长', isLeader: true },
      { id: 2, openid: 'mock_user_001', nickname: '老王', role: '打野' },
      { id: 3, openid: 'mock_user_003', nickname: '阿强', role: '', note: '21:40 到' }
    ]
  },
  {
    id: 2,
    title: '夜猫娱乐车',
    code: '夜猫行动',
    creatorOpenid: 'mock_user_004',
    creatorName: '阿坤',
    departTime: '22:40',
    capacity: 5,
    note: '快乐局，输赢随缘，主打一个不红温。',
    tags: ['不接受分差', '匹配车'],
    status: 'ready',
    passengers: [
      { id: 4, openid: 'mock_user_004', nickname: '阿坤', role: '队长', isLeader: true },
      { id: 5, openid: 'mock_user_005', nickname: '小李', role: '中路' },
      { id: 6, openid: 'mock_user_006', nickname: '石头', role: '上路' },
      { id: 7, openid: 'mock_user_007', nickname: '十三', role: 'AD' },
      { id: 8, openid: 'mock_user_008', nickname: '老周', role: '辅助' }
    ]
  },
  {
    id: 3,
    title: '五黑集结',
    code: '五黑满编',
    creatorOpenid: 'mock_user_001',
    creatorName: '老王',
    departTime: '23:20',
    capacity: 5,
    note: '人齐就开，来两个能指挥的。',
    tags: ['接受分差', '必须准时'],
    status: 'recruiting',
    passengers: [
      { id: 9, openid: 'mock_user_001', nickname: '老王', role: '队长', isLeader: true },
      { id: 10, openid: 'mock_user_009', nickname: '小白', role: '' }
    ]
  }
];
