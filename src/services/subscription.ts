import Taro from '@tarojs/taro';

export const SUBSCRIBE_TEMPLATE_IDS = {
  squadMemberChanged: 'lsmPbz6F-1use0Ej3i5rFucq75PZhWNhJKb2AQdxES0',
  squadStatusChanged: 'm_8t4Gz308eRqgkBF0u1voEpiFkFbgsavi2skoL_FDg'
};

const requestSubscribeMessage = Taro.requestSubscribeMessage as unknown as (
  options: { tmplIds: string[] }
) => Promise<Record<string, string>>;

const requestSubscribe = async (tmplIds: string[]) => {
  if (Taro.getEnv() === Taro.ENV_TYPE.WEB) return { accepted: [], rejected: tmplIds };

  try {
    const result = await requestSubscribeMessage({ tmplIds });
    const accepted = tmplIds.filter((id) => result[id] === 'accept');
    const rejected = tmplIds.filter((id) => result[id] !== 'accept');
    return { accepted, rejected };
  } catch (error) {
    console.warn('[Subscribe] request skipped', error);
    return { accepted: [], rejected: tmplIds };
  }
};

export const requestJoinSquadSubscribe = () => (
  requestSubscribe([SUBSCRIBE_TEMPLATE_IDS.squadStatusChanged])
);

export const requestCreateSquadSubscribes = () => (
  requestSubscribe([SUBSCRIBE_TEMPLATE_IDS.squadMemberChanged, SUBSCRIBE_TEMPLATE_IDS.squadStatusChanged])
);
