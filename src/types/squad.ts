export type SquadStatus = 'recruiting' | 'ready' | 'departed' | 'cancelled';

export interface Passenger {
  id: number;
  openid?: string;
  nickname: string;
  role: string;
  note?: string;
  isLeader?: boolean;
}

export interface Squad {
  id: number;
  title: string;
  code: string;
  creatorOpenid?: string;
  creatorName: string;
  departTime: string;
  capacity: number;
  note: string;
  tags: string[];
  status: SquadStatus;
  passengers: Passenger[];
  isJoined?: boolean;
  isCreator?: boolean;
}

export interface UserProfile {
  openid: string;
  nickname: string;
  joinedSquadIds: number[];
  createdSquadIds: number[];
  subscribedTemplateIds?: string[];
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
