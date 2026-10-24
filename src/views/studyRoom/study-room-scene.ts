/**
 * 自习室场景元数据：纯类型 + 纯数据 + 纯函数，无副作用。
 * 每个场景包含背景图键、主色、文案、3D 小岛配色和白噪音预设。
 */

export type StudyRoomScene =
  | 'rain'
  | 'snow'
  | 'cloud'
  | 'starry'
  | 'coast'
  | 'dawn'
  | 'summer'
  | 'pool'
  | 'wheat';

export type SceneAmbientPreset = 'rain' | 'snow' | 'cloud';

export interface StudyRoomSceneCopy {
  labelShort: string;
  labelLong: string;
  roomTitle: string;
  roomSlogan: string;
  primary: string;
  /** 页面光效和玻璃面板的辅助色。 */
  secondary: string;
  quotes: string[];
  /** 白噪音合成预设；cloud 为静音。 */
  ambientPreset: SceneAmbientPreset;
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
    secondary: '#5ab8b0',
    ambientPreset: 'rain',
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
    secondary: '#9ab0c8',
    ambientPreset: 'snow',
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
    secondary: '#b8c0c8',
    ambientPreset: 'cloud',
  },
  starry: {
    labelShort: '星夜',
    labelLong: '星夜',
    roomTitle: '星夜自习室',
    roomSlogan: '在星河下静心，让每一段专注都有光。',
    primary: '#b9c6ff',
    quotes: [
      '星星不会催你，它只是一直亮着。',
      '把今天写进夜里，明天会记得。',
      '在星河下，慢慢来也是一种前进。',
    ],
    secondary: '#7d8cff',
    ambientPreset: 'snow',
  },
  coast: {
    labelShort: '海岸',
    labelLong: '海岸',
    roomTitle: '海岸自习室',
    roomSlogan: '听潮起潮落，把注意力交给眼前这一页。',
    primary: '#8fe3d2',
    quotes: [
      '潮水有它的节奏，你也有你的。',
      '把烦恼交给海浪，把专注留给书页。',
      '海风吹过的地方，心也会变得开阔。',
    ],
    secondary: '#5bb8d4',
    ambientPreset: 'cloud',
  },
  dawn: {
    labelShort: '晨光',
    labelLong: '晨光',
    roomTitle: '晨光自习室',
    roomSlogan: '在第一束晨光里，慢慢进入状态。',
    primary: '#ffd39b',
    quotes: [
      '晨光不急，它知道你会来。',
      '新的一天，从一个安静的早晨开始。',
      '把第一束光，留给最重要的事。',
    ],
    secondary: '#f2a65e',
    ambientPreset: 'cloud',
  },
  summer: {
    labelShort: '夏日',
    labelLong: '夏日',
    roomTitle: '夏日自习室',
    roomSlogan: '在蝉鸣与光影里，把夏天写进书页。',
    primary: '#ffe08a',
    quotes: [
      '蝉鸣把夏天拉长，书页把时间留住。',
      '阳光落在桌上，正好照亮下一行。',
      '夏天适合慢一点，也适合再坚持一会儿。',
    ],
    secondary: '#9bd36a',
    ambientPreset: 'cloud',
  },
  pool: {
    labelShort: '池边',
    labelLong: '池边',
    roomTitle: '池边自习室',
    roomSlogan: '水光摇晃，心也跟着安静下来。',
    primary: '#7fe7e0',
    quotes: [
      '水面有波纹，心可以很平。',
      '让波浪负责流动，你负责专注。',
      '池边的风，会把杂念吹远。',
    ],
    secondary: '#4aa8e0',
    ambientPreset: 'cloud',
  },
  wheat: {
    labelShort: '麦田',
    labelLong: '麦田',
    roomTitle: '麦田自习室',
    roomSlogan: '风吹麦浪，专注在金色里生长。',
    primary: '#f2c66d',
    quotes: [
      '风吹麦浪，时间在金色里变慢。',
      '每一页书，都在为秋天积蓄。',
      '在麦田边，把今天认真收好。',
    ],
    secondary: '#d98f4a',
    ambientPreset: 'cloud',
  },
};

export const STUDY_ROOM_DEFAULT_SCENE: StudyRoomScene = 'rain';

export const STUDY_ROOM_SCENE_STORAGE_KEY = 'qingyan-study-room:scene:v1';

export function asStudyRoomScene(value: unknown): StudyRoomScene {
  return typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(STUDY_ROOM_SCENES, value)
    ? (value as StudyRoomScene)
    : STUDY_ROOM_DEFAULT_SCENE;
}

export function getStudyRoomSceneCopy(scene: StudyRoomScene): StudyRoomSceneCopy {
  return STUDY_ROOM_SCENES[scene];
}
