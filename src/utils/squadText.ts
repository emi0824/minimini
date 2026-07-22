import { Passenger, Squad } from '@/types/squad';
import { formatMonthDay } from '@/utils/date';

const formatMember = (passenger: Passenger): string => {
  const identity = passenger.gameId
    ? `${passenger.nickname}/${passenger.gameId}`
    : passenger.nickname;
  const note = passenger.note?.trim();
  return note ? `${identity}（${note}）` : identity;
};

export const formatSquadStatusText = (squad: Squad): string => {
  const leader = squad.passengers.find((passenger) => passenger.isLeader);
  const members = squad.passengers.filter((passenger) => passenger !== leader);
  const dateTime = [formatMonthDay(squad.departDate), squad.departTime].filter(Boolean).join(' ');
  const lines = [`「${dateTime}」${squad.title}（已有${squad.passengers.length}人上车）`];

  if (leader) {
    lines.push(`车队队长：${formatMember(leader)}`);
  } else {
    const creator = squad.creatorGameId
      ? `${squad.creatorName}/${squad.creatorGameId}`
      : squad.creatorName;
    lines.push(`车队队长：${creator}`);
  }

  if (members.length > 0) {
    lines.push(`车队成员：${formatMember(members[0])}`);
    members.slice(1).forEach((member) => lines.push(formatMember(member)));
  }

  const squadNote = squad.note?.trim();
  if (squadNote && squadNote !== '无备注') {
    lines.push('', squadNote);
  }

  return lines.join('\n');
};
