import { ref } from 'vue';

/**
 * 专注轮次是否在跑。
 * 浏览器会冻结长时间不可见、又不发声的标签页；冻结之后音频时钟一起停，
 * 排在音频时间轴上的结束提醒就永远不会响。所以专注期间环境音保持在后台播放。
 */
export const focusRoundActive = ref(false);