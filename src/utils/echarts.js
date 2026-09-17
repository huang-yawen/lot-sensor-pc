/**
 * 【文件职责】ECharts 按需装配。只注册项目实际用到的图表类型和组件，避免
 * `import * as echarts from 'echarts'` 把整个 echarts（所有图表类型 + SVG/Canvas
 * 双渲染器，压缩后 ~330KB）打进包里，减小首屏体积、加快解析。
 *
 * 用法：其它组件把
 *     import * as echarts from 'echarts'
 * 换成
 *     import * as echarts from '@/utils/echarts'
 * echarts.init(...) 等 API 用法完全不变。
 *
 * 新增图表类型或组件时，在下面 echarts.use([...]) 里补一行；漏加会导致对应图不显示
 * （控制台一般会有 "Series xxx is used but not imported" 之类的警告）。
 * 【配置中心关联】无。
 *
 * 目前用到：
 *   图表  折线/柱状(LineBarCharts、HistoryCharts) 散点(HistoryCharts 温度-流量相关性)
 *         饼图(PieChart 故障类型分布) 仪表盘(GaugeChart 实时水温)
 *   组件  标题(空数据占位 / 饼图标题) 提示框 直角坐标系 图例 工具栏(下载图/折柱切换)
 *         markLine(HistoryCharts PID/恒流速 跟踪对比的参考线)
 */
import * as echarts from 'echarts/core'
import { LineChart, BarChart, ScatterChart, PieChart, GaugeChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  ToolboxComponent,
  MarkLineComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
// 轴断开（ECharts 6）：LineBarCharts 把传感器图 y 轴上没有数据的空白段折叠掉，见 utils/chartAxis.js 的 buildAxisBreaks
import { AxisBreak } from 'echarts/features'

echarts.use([
  LineChart, BarChart, ScatterChart, PieChart, GaugeChart,
  TitleComponent, TooltipComponent, GridComponent, LegendComponent, ToolboxComponent, MarkLineComponent,
  CanvasRenderer,
  AxisBreak,
])

export * from 'echarts/core'
export default echarts
