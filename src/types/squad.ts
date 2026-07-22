export type SquadStatus = 'recruiting' | 'ready' | 'departed' | 'cancelled';

export interface Passenger {
  id: number;
  openid?: string;
  nickname: string;
  gameId?: string;
  role: string;
  note?: string;
  isLeader?: boolean;
  isSelf?: boolean;
}

export interface Squad {
  id: number;
  title: string;
  code: string;
  creatorOpenid?: string;
  creatorName: string;
  creatorGameId?: string;
  departDate?: string;
  departTime: string;
  capacity: number;
  note: string;
  tags: string[];
  status: SquadStatus;
  createdAt?: number;
  passengers: Passenger[];
  isJoined?: boolean;
  isCreator?: boolean;
}

export interface UserProfile {
  openid: string;
  nickname: string;
  gameId?: string;
  joinedSquadIds: number[];
  createdSquadIds: number[];
  role?: 'admin' | 'member';
  isRootAdmin?: boolean;
  disabled?: boolean;
  disabledAt?: number;
  disabledBy?: string;
  disabledReason?: string;
  groupVerified?: boolean;
  groupVerifiedAt?: number;
  groupOpenGid?: string;
}
