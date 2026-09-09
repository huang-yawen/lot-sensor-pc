/**
 * 【文件职责】按数量级把一张图里的多条 series 自动分到左右两根 y 轴。
 * 同一张图里如果温度（几十）和累计流量（几万）共用一根轴，小的那条会被压成
 * 贴着 0 的直线看不出变化，分到右轴各自缩放才能都看清。
 * 【谁在用】组件 LineBarCharts；页面 HistoryCharts（累计换热量图 / 开关时长图）。
 * 【配置中心关联】无。
 */

// 排序后相邻两条 series 的量级比值超过这个倍数，才认为中间有"断层"、值得拆成两根轴。
// 阈值调小会把本该同轴对比的线（比如进水温度和出水温度）拆开，两根轴各自缩放，
// 看上去两条线重合、实际差好几度，反而误导，所以宁可保守一些。
const SPLIT_RATIO = 5

/**
 * @description 按数量级挑出应该走右轴的 series
 * @param {Array<{name: string, data: Array}>} seriesList - 每条 series 的名字和纯数值数组
 * @returns {Set<string>} 需要走右轴的 series 名字；量级接近或数据全为 0 时返回空集合（保持单轴）
 */
export function pickRightAxisNames(seriesList) {
  if (!Array.isArray(seriesList) || seriesList.length < 2) return new Set()

  // 用最大绝对值代表一条 series 的量级，再从大到小排序
  const scales = seriesList
    .map((item) => ({
      name: item.name,
      scale: (item.data || []).reduce((max, value) => {
        const num = Math.abs(Number(value))
        return Number.isFinite(num) && num > max ? num : max
      }, 0),
    }))
    .sort((a, b) => b.scale - a.scale)

  // 全都是 0（比如某段时间没有任何数据）就没有量级可言，保持单轴
  if (scales[0].scale === 0) return new Set()

  // 找比值最大的那个断层，在它后面切一刀：前面的留左轴，后面的挪到右轴
  let cutIndex = -1
  let maxRatio = SPLIT_RATIO
  for (let i = 0; i < scales.length - 1; i++) {
    // 后一条全是 0 时视为无穷大断层，它确实需要单独一根轴才看得见
    const ratio = scales[i + 1].scale === 0 ? Infinity : scales[i].scale / scales[i + 1].scale
    if (ratio > maxRatio) {
      maxRatio = ratio
      cutIndex = i
    }
  }
  if (cutIndex === -1) return new Set()

  return new Set(scales.slice(cutIndex + 1).map((item) => item.name))
}

/**
 * @description 判断一根 y 轴能不能脱离 0 刻度（ECharts 的 scale: true）
 * 折线/散点让轴紧贴数据范围才能看清波动；柱状图不行——柱子长度要正比于数值，
 * 轴不从 0 起会把 29.0 和 29.2 画成差一大截，严重夸大差异。
 * @param {Array<{type?: string}>} seriesList - 挂在这根轴上的 series
 * @returns {boolean} 这根轴上没有柱状图且至少挂了一条 series 时为 true
 */
export function canScale(seriesList) {
  return Array.isArray(seriesList)
    && seriesList.length > 0
    && seriesList.every((item) => item.type !== 'bar')
}
