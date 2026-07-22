import Taro from '@tarojs/taro';
import { squads as initialSquads } from '@/data/squads';
import { Passenger, Squad } from '@/types/squad';
import { getCurrentUser } from '@/services/auth';
import { getSquadDepartAt, getSquadStatus, isSquadDeparted } from '@/utils/squad';

const SQUADS_KEY = 'gangwa_squads';
const BEIJING_OFFSET = 8 * 60 * 60 * 1000;

const getBeijingDate = () => new Date(Date.now() + BEIJING_OFFSET).toISOString().slice(0, 10);

const codeTextMap: Record<string, string> = {
  'RANKED SQUAD': '排位集结',
  'NIGHT OPS': '夜猫行动',
  'FULL STACK': '五黑满编',
  'CUSTOM SQUAD': '自定义车队'
};

const normalizeSquad = (squad: Squad): Squad => {
  const user = getCurrentUser();
  return {
    ...squad,
    code: codeTextMap[squad.code] || squad.code,
    departDate: squad.departDate || getBeijingDate(),
    departTime: (squad.departTime || '--:--').slice(0, 5),
    createdAt: squad.createdAt || squad.id,
    status: getSquadStatus(squad),
    isCreator: squad.creatorOpenid === user.openid,
    isJoined: squad.passengers.some((passenger) => passenger.openid === user.openid),
    passengers: squad.passengers.map((passenger) => ({
      ...passenger,
      isSelf: passenger.openid === user.openid
    }))
  };
};

const persist = (squads: Squad[]) => {
  Taro.setStorageSync(SQUADS_KEY, squads.map(normalizeSquad));
};

export const getSquads = (): Squad[] => {
  const cached = Taro.getStorageSync<Squad[]>(SQUADS_KEY);
  if (Array.isArray(cached)) {
    const active = cached.map(normalizeSquad).filter((item) => getSquadDepartAt(item) + 12 * 60 * 60 * 1000 > Date.now());
    if (active.length !== cached.length) persist(active);
    return active;
  }

  persist(initialSquads);
  return initialSquads.map(normalizeSquad);
};

export const getSquadById = (id: number): Squad | undefined => getSquads().find((item) => item.id === id);

export interface CreateSquadInput {
  title: string;
  departDate?: string;
  departTime: string;
  capacity: number;
  note: string;
  tags: string[];
  subscriptionTemplateIds?: string[];
}

export const createSquad = (input: CreateSquadInput): Squad => {
  const user = getCurrentUser();
  const squads = getSquads();
  const id = Math.max(0, ...squads.map((item) => item.id)) + 1;
  const passengerId = Date.now();
  if (getSquadDepartAt({ departDate: input.departDate, departTime: input.departTime }) <= Date.now()) {
    throw new Error('发车时间必须晚于当前时间');
  }
  const squad: Squad = normalizeSquad({
    id,
    title: input.title,
    code: '自定义车队',
    creatorOpenid: user.openid,
    creatorName: user.nickname,
    creatorGameId: user.gameId || '',
    departDate: input.departDate,
    departTime: input.departTime,
    capacity: input.capacity,
    note: input.note,
    tags: input.tags,
    status: 'recruiting',
    createdAt: Date.now(),
    passengers: [
      {
        id: passengerId,
        openid: user.openid,
        nickname: user.nickname,
        gameId: user.gameId || '',
        role: '队长',
        isLeader: true
      }
    ]
  });

  persist([squad, ...squads]);
  console.info('[Squad] create squad', { id });
  return squad;
};

export const updateSquad = (squadId: number, input: CreateSquadInput): Squad => {
  const user = getCurrentUser();
  const squads = getSquads();
  const squad = squads.find((item) => item.id === squadId);
  if (!squad) throw new Error('车队不存在');
  if (squad.creatorOpenid !== user.openid) throw new Error('只有队长可以修改车队信息');
  if (squad.passengers.some((passenger) => passenger.openid !== user.openid)) {
    throw new Error('车队已有成员，不支持修改信息');
  }
  if (isSquadDeparted(squad)) throw new Error('已发车车队不支持修改');

  const nextSquad = normalizeSquad({
    ...squad,
    title: input.title,
    departDate: input.departDate,
    departTime: input.departTime,
    capacity: input.capacity,
    note: input.note,
    tags: input.tags
  });
  persist(squads.map((item) => (item.id === squadId ? nextSquad : item)));
  console.info('[Squad] update squad', { squadId });
  return nextSquad;
};

export interface JoinSquadInput {
  nickname: string;
  gameId: string;
  role: string;
  note?: string;
  subscriptionTemplateIds?: string[];
}

export interface UpdatePassengerInfoInput {
  nickname: string;
  gameId: string;
  role: string;
  note?: string;
}

export const joinSquad = (squadId: number, input: JoinSquadInput): Squad => {
  const user = getCurrentUser();
  const squads = getSquads();
  const squad = squads.find((item) => item.id === squadId);
  if (!squad) throw new Error('车队不存在');
  if (squad.passengers.some((item) => item.openid === user.openid)) throw new Error('你已在车队中');
  if (isSquadDeparted(squad)) throw new Error('车队已发车，不支持加入');

  const passenger: Passenger = {
    id: Date.now(),
    openid: user.openid,
    nickname: input.nickname,
    gameId: input.gameId,
    role: input.role || '',
    note: input.note
  };

  const nextSquad = normalizeSquad({ ...squad, passengers: [...squad.passengers, passenger] });
  persist(squads.map((item) => (item.id === squadId ? nextSquad : item)));
  console.info('[Squad] join squad', { squadId });
  return nextSquad;
};

export const leaveSquad = (squadId: number): Squad => {
  const user = getCurrentUser();
  const squads = getSquads();
  const squad = squads.find((item) => item.id === squadId);
  if (!squad) throw new Error('车队不存在');
  if (isSquadDeparted(squad)) throw new Error('车队已发车，不支持退出');
  if (squad.creatorOpenid === user.openid) throw new Error('发起人不能下车，请解散车队');
  if (!squad.passengers.some((item) => item.openid === user.openid)) throw new Error('你不在该车队中');

  const nextSquad = normalizeSquad({ ...squad, passengers: squad.passengers.filter((item) => item.openid !== user.openid) });
  persist(squads.map((item) => (item.id === squadId ? nextSquad : item)));
  console.info('[Squad] leave squad', { squadId });
  return nextSquad;
};

export const updatePassengerInfo = (squadId: number, input: UpdatePassengerInfoInput): Squad => {
  const user = getCurrentUser();
  const squads = getSquads();
  const squad = squads.find((item) => item.id === squadId);
  if (!squad) throw new Error('车队不存在');
  if (isSquadDeparted(squad)) throw new Error('车队已发车，不支持修改上车资料');
  if (!squad.passengers.some((item) => item.openid === user.openid)) throw new Error('你不在该车队中');

  const nextNote = input.note?.trim();
  const nextSquad = normalizeSquad({
    ...squad,
    passengers: squad.passengers.map((passenger) => {
      if (passenger.openid !== user.openid) return passenger;
      const nextPassenger = { ...passenger };
      nextPassenger.nickname = input.nickname.trim();
      nextPassenger.gameId = input.gameId.trim();
      nextPassenger.role = input.role.trim();
      if (nextNote) nextPassenger.note = nextNote;
      else delete nextPassenger.note;
      return nextPassenger;
    })
  });
  persist(squads.map((item) => (item.id === squadId ? nextSquad : item)));
  return nextSquad;
};

export const dismissSquad = (squadId: number): void => {
  const user = getCurrentUser();
  const squads = getSquads();
  const squad = squads.find((item) => item.id === squadId);
  if (!squad) throw new Error('车队不存在');
  if (isSquadDeparted(squad)) throw new Error('车队已发车，不支持解散');
  if (squad.creatorOpenid !== user.openid) throw new Error('只有发起人可以解散车队');

  persist(squads.filter((item) => item.id !== squadId));
  console.info('[Squad] dismiss squad', { squadId });
};

export const syncNicknameInSquads = (openid: string, nickname: string, gameId?: string) => {
  const squads = getSquads().map((squad) => normalizeSquad({
    ...squad,
    creatorName: squad.creatorOpenid === openid ? nickname : squad.creatorName,
    creatorGameId: squad.creatorOpenid === openid ? (gameId ?? squad.creatorGameId) : squad.creatorGameId,
    passengers: squad.passengers.map((passenger) => (
      passenger.openid === openid ? { ...passenger, nickname, gameId: gameId ?? passenger.gameId } : passenger
    ))
  }));
  persist(squads);
};

export const getNearbySquads = (departDate: string, departTime: string, excludeId = 0): Squad[] => {
  const target = getSquadDepartAt({ departDate, departTime });
  return getSquads().filter((squad) => (
    squad.id !== excludeId
    && squad.departDate === departDate
    && Math.abs(getSquadDepartAt(squad) - target) <= 30 * 60 * 1000
  ));
};
