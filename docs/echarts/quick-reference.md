# ECharts 快速参考卡片

> 本文档提供 ECharts 常用配置的快速参考，方便开发时查阅。

---

## 一、安装与引入

```bash
# npm 安装
npm install echarts --save

# yarn 安装
yarn add echarts
```

```javascript
// 完整引入
import * as echarts from 'echarts';

// 按需引入（推荐）
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  GridComponent
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart, LineChart, PieChart,
  TitleComponent, TooltipComponent, GridComponent,
  CanvasRenderer
]);
```

---

## 二、初始化与销毁

```javascript
// 初始化
const chart = echarts.init(document.getElementById('main'));

// 指定主题
const chart = echarts.init(document.getElementById('main'), 'dark');

// 指定大小
const chart = echarts.init(document.getElementById('main'), null, {
  width: 600,
  height: 400
});

// 设置配置项
chart.setOption(option);

// 增量更新（不替换已有配置）
chart.setOption(newOption, false);

// 响应容器大小变化
window.addEventListener('resize', () => chart.resize());

// 销毁实例
chart.dispose();
```

---

## 三、基础配置结构

```javascript
option = {
  // 标题
  title: {
    text: '主标题',
    subtext: '副标题',
    left: 'center',  // 'left' | 'center' | 'right'
    top: 20
  },
  
  // 提示框
  tooltip: {
    trigger: 'axis',  // 'item' | 'axis' | 'none'
    formatter: '{b}: {c}'  // 自定义格式
  },
  
  // 图例
  legend: {
    data: ['系列1', '系列2'],
    orient: 'horizontal',  // 'horizontal' | 'vertical'
    right: 10,
    top: 20
  },
  
  // 网格
  grid: {
    left: '3%',
    right: '4%',
    bottom: '3%',
    containLabel: true
  },
  
  // X轴
  xAxis: {
    type: 'category',  // 'category' | 'value' | 'time' | 'log'
    data: ['Mon', 'Tue', 'Wed'],
    axisLabel: { rotate: 0 }
  },
  
  // Y轴
  yAxis: {
    type: 'value',
    min: 0,
    max: 100
  },
  
  // 数据缩放
  dataZoom: [
    { type: 'inside', start: 0, end: 100 },
    { type: 'slider', start: 0, end: 100 }
  ],
  
  // 工具栏
  toolbox: {
    feature: {
      saveAsImage: {},
      dataZoom: {},
      restore: {}
    }
  },
  
  // 系列
  series: [
    {
      name: '系列1',
      type: 'bar',  // 'bar' | 'line' | 'pie' | 'scatter' | ...
      data: [120, 200, 150]
    }
  ]
};
```

---

## 四、常用图表类型

### 柱状图 (Bar)

```javascript
{
  type: 'bar',
  data: [120, 200, 150, 80, 70],
  barWidth: '20%',
  itemStyle: {
    color: '#5470c6',
    borderRadius: [4, 4, 0, 0]
  }
}
```

### 折线图 (Line)

```javascript
{
  type: 'line',
  data: [120, 200, 150, 80, 70],
  smooth: true,  // 平滑曲线
  areaStyle: {},  // 面积填充
  lineStyle: {
    width: 2,
    type: 'solid'  // 'solid' | 'dashed' | 'dotted'
  }
}
```

### 饼图 (Pie)

```javascript
{
  type: 'pie',
  radius: '50%',  // 或 ['40%', '70%'] 圆环图
  data: [
    { value: 335, name: '直接访问' },
    { value: 310, name: '邮件营销' }
  ],
  emphasis: {
    itemStyle: {
      shadowBlur: 10,
      shadowColor: 'rgba(0, 0, 0, 0.5)'
    }
  }
}
```

### 散点图 (Scatter)

```javascript
{
  type: 'scatter',
  data: [
    [10.0, 8.04],
    [8.0, 6.95],
    [13.0, 7.58]
  ],
  symbolSize: 10
}
```

### 仪表盘 (Gauge)

```javascript
{
  type: 'gauge',
  data: [{ value: 70, name: '完成率' }],
  detail: { formatter: '{value}%' }
}
```

### 雷达图 (Radar)

```javascript
{
  type: 'radar',
  data: [
    {
      value: [4200, 3000, 20000],
      name: '预算分配'
    }
  ]
}
```

---

## 五、样式设置

### 颜色主题

```javascript
// 深色主题
const chart = echarts.init(dom, 'dark');

// 自定义主题
echarts.registerTheme('myTheme', {
  color: ['#5470c6', '#91cc75', '#fac858'],
  // ...
});
const chart = echarts.init(dom, 'myTheme');
```

### 调色盘

```javascript
option = {
  color: ['#c23531', '#2f4554', '#61a0a8', '#d48265'],
  series: [{
    type: 'bar',
    data: [120, 200, 150]
  }]
};
```

### 直接样式

```javascript
{
  type: 'bar',
  itemStyle: {
    color: 'red',
    borderColor: 'black',
    borderWidth: 1,
    borderRadius: 4,
    opacity: 0.8,
    shadowBlur: 10,
    shadowColor: 'rgba(0, 0, 0, 0.5)'
  },
  label: {
    show: true,
    position: 'top',
    color: '#333',
    fontSize: 12
  }
}
```

### 高亮样式

```javascript
{
  type: 'bar',
  itemStyle: { color: 'red' },
  emphasis: {
    itemStyle: { color: 'blue' },
    label: { show: true }
  }
}
```

---

## 六、数据集 (Dataset)

```javascript
option = {
  dataset: {
    dimensions: ['product', '2015', '2016', '2017'],
    source: [
      { product: 'Matcha Latte', '2015': 43.3, '2016': 85.8, '2017': 93.7 },
      { product: 'Milk Tea', '2015': 83.1, '2016': 73.4, '2017': 55.1 }
    ]
  },
  xAxis: { type: 'category' },
  yAxis: {},
  series: [{ type: 'bar' }, { type: 'bar' }, { type: 'bar' }]
};
```

---

## 七、事件处理

```javascript
// 点击事件
chart.on('click', (params) => {
  console.log(params.name, params.value);
});

// 图例选择事件
chart.on('legendselectchanged', (params) => {
  console.log(params.selected);
});

// 数据缩放事件
chart.on('datazoom', (params) => {
  console.log(params);
});

// 移除事件监听
chart.off('click');
```

---

## 八、动态数据更新

```javascript
// 基础更新
chart.setOption({
  series: [{ data: [1, 2, 3, 4, 5] }]
});

// 增量更新
chart.setOption({
  series: [{ data: [5, 4, 3, 2, 1] }]
}, false);

// 模拟实时数据
setInterval(() => {
  const data = [];
  for (let i = 0; i < 7; i++) {
    data.push(Math.round(Math.random() * 100));
  }
  chart.setOption({
    series: [{ data }]
  });
}, 1000);
```

---

## 九、常用坐标轴类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `category` | 类目轴 | `['Mon', 'Tue', 'Wed']` |
| `value` | 数值轴 | 自动计算范围 |
| `time` | 时间轴 | `'2023-01-01'` |
| `log` | 对数轴 | 适用于指数级数据 |

---

## 十、常用系列类型

| 类型 | 说明 | 配置项 |
|------|------|--------|
| `bar` | 柱状图 | `barWidth`, `barGap`, `barCategoryGap` |
| `line` | 折线图 | `smooth`, `areaStyle`, `step` |
| `pie` | 饼图 | `radius`, `roseType`, `center` |
| `scatter` | 散点图 | `symbolSize`, `symbol` |
| `candlestick` | K线图 | 需要 `[open, close, low, high]` 格式 |
| `radar` | 雷达图 | 需要 `radar` 配置组件 |
| `gauge` | 仪表盘 | `min`, `max`, `progress` |
| `funnel` | 漏斗图 | `sort`, `gap` |
| `map` | 地图 | 需要注册地图数据 |

---

## 十一、响应式处理

```javascript
// 窗口大小变化
window.addEventListener('resize', () => chart.resize());

// 使用 ResizeObserver（推荐）
const observer = new ResizeObserver(() => chart.resize());
observer.observe(document.getElementById('main'));

// 容器销毁
function destroy() {
  chart.dispose();
  chart = null;
}
```

---

## 十二、常见问题

### 图表不显示

1. 检查容器是否有宽高
2. 检查 `echarts.init` 是否正确调用
3. 检查 `setOption` 是否执行

### 图表尺寸不正确

1. 确保容器在 `echarts.init` 时已有宽高
2. 调用 `chart.resize()` 更新尺寸

### 图表刷新闪烁

1. 使用增量更新 `chart.setOption(newOption, false)`
2. 避免频繁销毁重建

### 内存泄漏

1. 组件销毁时调用 `chart.dispose()`
2. 移除事件监听 `chart.off('click')`

---

## 十三、参考链接

- 官方文档：https://echarts.apache.org/handbook/zh/
- 配置项手册：https://echarts.apache.org/zh/option.html
- API 文档：https://echarts.apache.org/zh/api.html
- 示例中心：https://echarts.apache.org/examples/zh/index.html
- 主题编辑器：https://echarts.apache.org/zh/theme-builder.html
