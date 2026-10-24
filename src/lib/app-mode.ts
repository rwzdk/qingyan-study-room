/** 静态构建：不启用登录与云端同步，数据写入浏览器 localStorage。 */
export const STATIC_MODE = import.meta.env.VITE_STATIC_MODE === 'true';
