const REGION_NAMES: Record<string, string> = {
  Anhui: '安徽',
  Beijing: '北京',
  Chongqing: '重庆',
  Fujian: '福建',
  Gansu: '甘肃',
  Guangdong: '广东',
  Guangxi: '广西',
  Guizhou: '贵州',
  Hainan: '海南',
  Hebei: '河北',
  Heilongjiang: '黑龙江',
  Henan: '河南',
  Hubei: '湖北',
  Hunan: '湖南',
  'Inner Mongolia': '内蒙古',
  Jiangsu: '江苏',
  Jiangxi: '江西',
  Jilin: '吉林',
  Liaoning: '辽宁',
  Macau: '澳门',
  Ningxia: '宁夏',
  Qinghai: '青海',
  Shaanxi: '陕西',
  Shandong: '山东',
  Shanghai: '上海',
  Shanxi: '山西',
  Sichuan: '四川',
  Taiwan: '台湾',
  Tianjin: '天津',
  Tibet: '西藏',
  'Hong Kong': '香港',
  Xinjiang: '新疆',
  Yunnan: '云南',
  Zhejiang: '浙江',
};

const COUNTRY_NAMES: Record<string, string> = {
  CN: '中国',
  HK: '中国香港',
  MO: '中国澳门',
  TW: '中国台湾',
};

function countryName(code: string): string {
  if (!code) return '';
  if (COUNTRY_NAMES[code]) return COUNTRY_NAMES[code];
  try {
    const names = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

function regionName(region: string): string {
  return REGION_NAMES[region] ?? region;
}

export interface PlaceLike {
  country?: string;
  region?: string;
  city?: string;
}

/** 只展示国家/省/城市三级，不展示 IP 或经纬度。 */
export function locationLabel(place: PlaceLike): string {
  const country = countryName(place.country ?? '');
  const rawRegion = (place.region ?? '').trim();
  const region = regionName(rawRegion);
  const city = (place.city ?? '').trim();
  const parts = [country];
  if (region && region !== country) parts.push(region);
  const cityIsRegion =
    !!city &&
    (city.toLowerCase() === rawRegion.toLowerCase() ||
      city === region ||
      city === country);
  if (city && !cityIsRegion) parts.push(city);
  return parts.filter(Boolean).join(' · ') || '未知地区';
}

export function dayLabel(date: string): string {
  return date.length >= 10 ? date.slice(5) : date;
}
