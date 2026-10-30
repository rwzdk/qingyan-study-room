import { cachedAdminStats, cloudAdminStats, readCloudSession } from '#/api/study-cloud';

let started = false;

/**
 * 管理员进自习室后趁空闲先拉一次统计：到云端的连接握手会抖到十几秒，
 * 等点开管理页时才拉就要当场干等；预取后切进去直接是现成的数据。
 */
export function prefetchAdminStats(): void {
  if (started || cachedAdminStats()) return;
  const session = readCloudSession();
  if (!session?.isAdmin) return;
  started = true;
  void cloudAdminStats(session.token).catch(() => {
    started = false;
  });
}
