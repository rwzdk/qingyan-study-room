/**
 * 自习室场景元数据：纯类型 + 纯数据 + 纯函数，无副作用。
 * 复刻 summer-checkin 的场景语义（雨林 / 雪日 / 暖云），
 * 文案与主色沿用其 SCENE_COPY / SCENE_THEMES 思路。
 */

export type StudyRoomScene = 'rain' | 'snow' | 'cloud';

export interface StudyRoomSceneCopy {
  labelShort: string;
  labelLong: string;
  roomTitle: string;
  roomSlogan: string;
  primary: string;
  quotes: string[];
}

export const STUDY_ROOM_SCENES: Record<StudyRoomScene, StudyRoomSceneCopy> = {
  rain: {
    labelShort: '雨林',
    labelLong: '雨林',
    roomTitle: '雨林自习室',
    roomSlogan: '在雨声中沉浸，让每一段专注都有节奏。',
    primary: '#d7ef83',
    quotes: [
      '雨林深处，专注是最温柔的光。',
      '雨落进书页的缝隙，时间便有了声音。',
      '每一滴雨，都在为坚持的你鼓掌。',
    ],
  },
  snow: {
    labelShort: '雪日',
    labelLong: '雪日',
    roomTitle: '雪日自习室',
    roomSlogan: '在雪落中入定，让每一段专注都安静而坚定。',
    primary: '#d4e2f0',
    quotes: [
      '雪地里的脚印，每一步都算数。',
      '雪花从不会急着落对地方，你也不必慌张。',
      '最安静的雪天，最适合听自己成长的声音。',
    ],
  },
  cloud: {
    labelShort: '暖云',
    labelLong: '暖云',
    roomTitle: '暖云自习室',
    roomSlogan: '在云影里舒展，让每一段专注都柔软而悠长。',
    primary: '#e0e0e0',
    quotes: [
      '云卷云舒之间，专注慢慢长出形状。',
      '把心挂在云上，再沉的事也会变轻。',
      '云知道所有答案，你只需慢慢向前。',
    ],
  },
};

export const STUDY_ROOM_DEFAULT_SCENE: StudyRoomScene = 'rain';

export const STUDY_ROOM_SCENE_STORAGE_KEY = 'qingyan-study-room:scene:v1';

export function asStudyRoomScene(value: unknown): StudyRoomScene {
  return value === 'rain' || value === 'snow' || value === 'cloud'
    ? value
    : STUDY_ROOM_DEFAULT_SCENE;
}

export function getStudyRoomSceneCopy(scene: StudyRoomScene): StudyRoomSceneCopy {
  return STUDY_ROOM_SCENES[scene];
}
