/**
 * 【文件职责】把一张图里的多条 series 自动分到左右两根 y 轴，两个判据：
 * pickRightAxisNames 看数量级断层（温度几十 vs 累计流量几万），
 * pickFlatAxisNames 看波动幅度（量级接近，但其中一条的起伏被另一条的量程压平）。
 * 小的那条被压成直线看不出变化，分到右轴各自缩放才能都看清。
 * 另外 buildAxisBreaks 走另一条路：不拆轴，而是在同一根轴上把没有数据的空白区间折叠掉。
 * 【谁在用】组件 LineBarCharts（buildAxisBreaks / canScale）；页面 HistoryCharts（累计换热量图 / 开关时长图）。
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

// 一条 series 自身的波动幅度（max-min）占同轴全局量程的比例低于这个值，就认为它在共用轴上
// 被压成了一条直线。5% 意味着在 320px 高的图里它的起伏不到 16px，肉眼基本看不出变化。
// 这个判据和 SPLIT_RATIO 的量级判据互补：温度 29 和湿度 60 量级只差 2 倍不会触发拆轴，
// 但温度常年只在 0.3℃ 内波动，被湿度的量程压平，这种情况只有看波动幅度才拆得出来。
const FLAT_RATIO = 0.05

/**
 * @description 按波动幅度挑出被压平、该挪到右轴的 series
 * @param {Array<{name: string, data: Array}>} seriesList - 每条 series 的名字和纯数值数组
 * @returns {Set<string>} 需要走右轴的 series 名字；没有被压平的、或者全都被压平时返回空集合（保持单轴）
 */
export function pickFlatAxisNames(seriesList) {
  if (!Array.isArray(seriesList) || seriesList.length < 2) return new Set()

  const stats = seriesList
    .map((item) => {
      const nums = (item.data || []).map(Number).filter((num) => Number.isFinite(num))
      if (nums.length === 0) return null
      return { name: item.name, min: Math.min(...nums), max: Math.max(...nums) }
    })
    .filter(Boolean)
  if (stats.length < 2) return new Set()

  // 所有 series 挤在同一根轴上时轴要覆盖的总量程
  const globalRange = Math.max(...stats.map((item) => item.max)) - Math.min(...stats.map((item) => item.min))
  // 全部数据是同一个常数，没有波动可言，拆轴也没用
  if (globalRange === 0) return new Set()

  const flat = stats.filter((item) => (item.max - item.min) / globalRange < FLAT_RATIO)
  // 一条都没压平不用拆；全都压平说明没有"大的那组"当基准，拆了两边还是平的
  if (flat.length === 0 || flat.length === stats.length) return new Set()

  return new Set(flat.map((item) => item.name))
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

// 每个变量的数据区间上下各留多少余量：取"自身波动幅度的 30%"和"数值本身的 0.5%"里大的那个，
// 再保底 0.01。只按波动留余量的话，一个完全不变的量（比如压力一直 10.3）余量是 0，
// 线会贴着轴边画、看不清；按数值比例保底，就能在线的上下留出一点空间。
const BAND_PAD_RATIO = 0.3
const BAND_PAD_VALUE_RATIO = 0.005
const BAND_PAD_MIN = 0.01

/**
 * @description 算出一根 y 轴上该折叠掉的空白区间（ECharts 6 的 yAxis.breaks），让量级相差很大的
 * 几个变量画在同一根轴上、各自的波动都能看清。
 *
 * 为什么需要：温度≈35.3、压力≈10.3、流量≈3.5 画在同一根普通数值轴上，轴要从 3 覆盖到 36，
 * 刻度被平均分成 0/10/20/30/40，温度 0.3℃ 的波动只占图高 1%，三条线都是平的。实际上
 * 3.6~10.1、10.4~35.0 这两大段根本没有数据，把它们折叠成锯齿断口，剩下的轴高度全部
 * 留给有数据的三小段，刻度也只标在这三段里（3.3/3.4… 10.2/10.3… 35.2/35.4…）。
 *
 * 算法：
 *   1. 每个变量取 [最小值, 最大值]，上下加余量（见上面三个常量），边界取整到整齐的步长
 *      （0.1、0.2、0.5、1…），刻度文字才不会是 35.67725 这种长小数；变量本身都 >= 0 时，
 *      下边界不会被余量推到负数。
 *   2. 按下边界排序，把有重叠的区间合并——进水、出水温度都在 35 左右，合成一段。
 *   3. 相邻两段之间的空白，比这两段自身高度加起来还大，才折叠；空白不大就并成一段，
 *      不值得打一个断口（断口多了反而难读）。
 *
 * 用法（LineBarCharts 里）：
 *   const info = buildAxisBreaks(axisSeries)
 *   yAxis: { type: 'value', scale: true, min: info.min, max: info.max, breaks: info.breaks }
 *   同时要在 utils/echarts.js 里 echarts.use(AxisBreak)，否则 breaks 配置不生效。
 *
 * ⚠ 只适合折线/散点。柱状图的柱长要跟数值成正比，折叠会让柱子高度失真，调用方要先用
 *   canScale 判断，柱状图不要调用。
 *
 * @param {Array<{name: string, data: Array}>} seriesList - 挂在这根轴上的 series
 * @returns {{min: number, max: number, breaks: Array<{start: number, end: number, gap: string}>}|null}
 *   min/max 是整根轴的范围；breaks 为空数组表示所有变量挤在一段里、不需要折叠（但 min/max 仍然贴合数据）；
 *   没有任何有效数值、或所有点都是同一个值时返回 null，调用方按普通数值轴处理
 */
export function buildAxisBreaks(seriesList) {
  if (!Array.isArray(seriesList)) return null

  // 所有变量的所有点都是同一个值（典型是设备离线、读数全被当成 0）：没有波动可贴合，
  // 硬算会得到 0~0.01、刻度 0.002/0.004 这种没意义的轴，直接交给 ECharts 默认处理
  const allNums = seriesList.flatMap((item) => (item.data || []).map(Number).filter((num) => Number.isFinite(num)))
  if (allNums.length === 0 || Math.min(...allNums) === Math.max(...allNums)) return null

  const bands = seriesList
    .map((item) => {
      const nums = (item.data || []).map(Number).filter((num) => Number.isFinite(num))
      if (nums.length === 0) return null
      const min = Math.min(...nums)
      const max = Math.max(...nums)
      const pad = Math.max((max - min) * BAND_PAD_RATIO, Math.abs((max + min) / 2) * BAND_PAD_VALUE_RATIO, BAND_PAD_MIN)
      // 取整步长：大约把这一段分成 3 格，再往上取成 1/2/5 × 10^n 这种整齐的数
      const rough = (max - min + pad * 2) / 3
      const magnitude = Math.pow(10, Math.floor(Math.log10(rough)))
      const step = [1, 2, 5, 10].map((k) => k * magnitude).find((value) => value >= rough)
      // 用步长的小数位数把结果修正一下，避免 10.100000000000001 这种浮点误差出现在刻度上
      const decimals = Math.max(0, -Math.floor(Math.log10(step)))
      const round = (value) => Number(value.toFixed(decimals))
      let lo = round(Math.floor((min - pad) / step) * step)
      const hi = round(Math.ceil((max + pad) / step) * step)
      if (min >= 0 && lo < 0) lo = 0
      return { lo, hi }
    })
    .filter(Boolean)
    .sort((a, b) => a.lo - b.lo)
  if (bands.length === 0) return null

  const merged = [{ ...bands[0] }]
  for (const band of bands.slice(1)) {
    const current = merged[merged.length - 1]
    const gap = band.lo - current.hi
    if (gap <= (current.hi - current.lo) + (band.hi - band.lo)) {
      current.hi = Math.max(current.hi, band.hi)
    } else {
      merged.push({ ...band })
    }
  }

  const breaks = []
  for (let i = 0; i < merged.length - 1; i++) {
    // gap 是断口在图上占的高度（占轴长的比例）。太小断口两侧的刻度文字会叠在一起
    breaks.push({ start: merged[i].hi, end: merged[i + 1].lo, gap: '10%' })
  }
  return { min: merged[0].lo, max: merged[merged.length - 1].hi, breaks }
}
