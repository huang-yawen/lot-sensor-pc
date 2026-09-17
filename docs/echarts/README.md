# Apache ECharts 使用手册

> 本文档根据 Apache ECharts 官方文档整理，供项目开发参考。
> 官方网站：https://echarts.apache.org

---

## 目录

1. [快速上手](#快速上手)
2. [在项目中引入 ECharts](#在项目中引入-echarts)
3. [图表容器及大小](#图表容器及大小)
4. [样式设置](#样式设置)
5. [数据集](#数据集)
6. [常用图表类型](#常用图表类型)

---

## 快速上手

### 获取 Apache ECharts

Apache ECharts 支持多种下载方式，可以在下载页面查看所有方式。这里以从 jsDelivr CDN 上获取为例。

在 https://www.jsdelivr.com/package/npm/echarts 选择 `dist/echarts.js`，点击并保存为 `echarts.js` 文件。

### 引入 Apache ECharts

在刚才保存 `echarts.js` 的目录新建一个 `index.html` 文件，内容如下：

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <!-- 引入刚刚下载的 ECharts 文]\
     件 -->
    <script src="echarts.js"></script>
  </head>
</html>
```

打开这个 `index.html`，你会看到一片空白。但是不要担心，打开控制台确认没有报错信息，就可以进行下一步。

### 绘制一个简单的图表

在绘图前我们需要为 ECharts 准备一个定义了高宽的 DOM 容器。在刚才的例子 `</head>` 之后，添加：

```html
<body>
  <!-- 为 ECharts 准备一个定义了宽高的 DOM -->
  <div id="main" style="width: 600px;height:400px;"></div>
</body>
```

然后就可以通过 `echarts.init` 方法初始化一个 echarts 实例并通过 `setOption` 方法生成一个简单的柱状图，下面是完整代码。

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>ECharts</title>
    <!-- 引入刚刚下载的 ECharts 文件 -->
    <script src="echarts.js"></script>
  </head>
  <body>
    <!-- 为 ECharts 准备一个定义了宽高的 DOM -->
    <div id="main" style="width: 600px;height:400px;"></div>
    <script type="text/javascript">
      // 基于准备好的dom，初始化echarts实例
      var myChart = echarts.init(document.getElementById('main'));

      // 指定图表的配置项和数据
      var option = {
        title: {
          text: 'ECharts 入门示例'
        },
        tooltip: {},
        legend: {
          data: ['销量']
        },
        xAxis: {
          data: ['衬衫', '羊毛衫', '雪纺衫', '裤子', '高跟鞋', '袜子']
        },
        yAxis: {},
        series: [
          {
            name: '销量',
            type: 'bar',
            data: [5, 20, 36, 10, 10, 20]
          }
        ]
      };

      // 使用刚指定的配置项和数据显示图表。
      myChart.setOption(option);
    </script>
  </body>
</html>
```

这样你的第一个图表就诞生了！

---

## 在项目中引入 ECharts

假如你的开发环境使用了 `npm` 或者 `yarn` 等包管理工具，并且使用 `webpack` 等打包工具进行构建，本文将会介绍如何引入 Apache ECharts 并通过 tree-shaking 特性只打包需要的模块以减少包体积。

### NPM 安装 ECharts

你可以使用如下命令通过 npm 安装 ECharts

```bash
npm install echarts --save
```

### 引入 ECharts

```javascript
import * as echarts from 'echarts';

// 基于准备好的dom，初始化echarts实例
var myChart = echarts.init(document.getElementById('main'));
// 绘制图表
myChart.setOption({
  title: {
    text: 'ECharts 入门示例'
  },
  tooltip: {},
  xAxis: {
    data: ['衬衫', '羊毛衫', '雪纺衫', '裤子', '高跟鞋', '袜子']
  },
  yAxis: {},
  series: [
    {
      name: '销量',
      type: 'bar',
      data: [5, 20, 36, 10, 10, 20]
    }
  ]
});
```

### 按需引入 ECharts 图表和组件

上面的代码会引入 ECharts 中所有的图表和组件，如果你不想引入所有组件，也可以使用 ECharts 提供的按需引入的接口来打包必须的组件。

```javascript
// 引入 echarts 核心模块，核心模块提供了 echarts 使用必须要的接口。
import * as echarts from 'echarts/core';
// 引入柱状图图表，图表后缀都为 Chart
import { BarChart } from 'echarts/charts';
// 引入标题，提示框，直角坐标系，数据集，内置数据转换器组件，组件后缀都为 Component
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  DatasetComponent,
  TransformComponent
} from 'echarts/components';
// 标签自动布局、全局过渡动画等特性
import { LabelLayout, UniversalTransition } from 'echarts/features';
// 引入 Canvas 渲染器，注意引入 CanvasRenderer 或者 SVGRenderer 是必须的一步
import { CanvasRenderer } from 'echarts/renderers';

// 注册必须的组件
echarts.use([
  TitleComponent,
  TooltipComponent,
  GridComponent,
  DatasetComponent,
  TransformComponent,
  BarChart,
  LabelLayout,
  UniversalTransition,
  CanvasRenderer
]);

// 接下来的使用就跟之前一样，初始化图表，设置配置项
var myChart = echarts.init(document.getElementById('main'));
myChart.setOption({
  // ...
});
```

> 需要注意的是为了保证打包的体积是最小的，ECharts 按需引入的时候不再提供任何渲染器，所以需要选择引入 `CanvasRenderer` 或者 `SVGRenderer` 作为渲染器。这样的好处是假如你只需要使用 svg 渲染模式，打包的结果中就不会再包含无需使用的 `CanvasRenderer` 模块。

---

## 图表容器及大小

### 初始化

#### 在 HTML 中定义有宽度和高度的父容器（推荐）

通常来说，需要在 HTML 中先定义一个 `<div>` 节点，并且通过 CSS 使得该节点具有宽度和高度。初始化的时候，传入该节点，图表的大小默认即为该节点的大小，除非声明了 `opts.width` 或 `opts.height` 将其覆盖。

```html
<div id="main" style="width: 600px;height:400px;"></div>
<script type="text/javascript">
  var myChart = echarts.init(document.getElementById('main'));
</script>
```

需要注意的是，使用这种方法在调用 `echarts.init` 时需保证容器已经有宽度和高度了。

#### 指定图表的大小

如果图表容器不存在宽度和高度，或者，你希望图表宽度和高度不等于容器大小，也可以在初始化的时候指定大小。

```html
<div id="main"></div>
<script type="text/javascript">
  var myChart = echarts.init(document.getElementById('main'), null, {
    width: 600,
    height: 400
  });
</script>
```

### 响应容器大小的变化

#### 监听图表容器的大小并改变图表大小

在有些场景下，我们希望当容器大小改变时，图表的大小也相应地改变。

比如，图表容器是一个高度为 400px、宽度为页面 100% 的节点，你希望在浏览器宽度改变的时候，始终保持图表宽度是页面的 100%。

这种情况下，可以监听页面的 `resize` 事件获取浏览器大小改变的事件，然后调用 `echartsInstance.resize` 改变图表的大小。

```html
<style>
  #main,
  html,
  body {
    width: 100%;
  }
  #main {
    height: 400px;
  }
</style>
<div id="main"></div>
<script type="text/javascript">
  var myChart = echarts.init(document.getElementById('main'));
  window.addEventListener('resize', function() {
    myChart.resize();
  });
</script>
```

> 小贴士：有时候我们可能会通过 JS 或 CSS 调整容器大小，由于页面大小并未发生改变，因此 `resize` 事件将不会被触发。如果有需要覆盖这种情况，可以借助浏览器的 `ResizeObserver` API 来实现更细粒度的监听。

#### 为图表设置特定的大小

除了直接调用 `resize()` 不含参数的形式之外，还可以指定宽度和高度，实现图表大小不等于容器大小的效果。

```javascript
myChart.resize({
  width: 800,
  height: 400
});
```

#### 容器节点被销毁以及被重建时

假设页面中存在多个标签页，每个标签页都包含一些图表。当选中一个标签页的时候，其他标签页的内容在 DOM 中被移除了。这样，当用户再选中这些标签页的时候，就会发现图表"不见"了。

本质上，这是由于图表的容器节点被移除导致的。即使之后该节点被重新添加，图表所在的节点也已经不存在了。

正确的做法是，在图表容器被销毁之后，调用 `echartsInstance.dispose` 销毁实例，在图表容器重新被添加后再次调用 `echarts.init` 初始化。

> 小贴士：在容器节点被销毁时，总是应调用 `echartsInstance.dispose` 以销毁实例释放资源，避免内存泄漏。

---

## 样式设置

本文介绍这几种方式，他们的功能范畴可能会有交叉（即同一种细节的效果可能可以用不同的方式实现），但是他们各有各的场景偏好。

- 颜色主题（Theme）
- 调色盘
- 直接样式设置（itemStyle、lineStyle、areaStyle、label、...）
- 视觉映射（visualMap）

### 颜色主题（Theme）

最简单的更改全局样式的方式，是直接采用颜色主题（theme）。例如，在示例集合中，可以通过切换深色模式，直接看到采用主题的效果。

ECharts5 除了一贯的默认主题外，还内置了`'dark'`主题。可以像这样切换成深色模式：

```javascript
var chart = echarts.init(dom, 'dark');
```

其他的主题，没有内置在 ECharts 中，需要自己加载。这些主题可以在主题编辑器里访问到。也可以使用这个主题编辑器，自己编辑主题。下载下来的主题可以这样使用：

如果主题保存为 JSON 文件，则需要自行加载和注册，例如：

```javascript
// 假设主题名称是 "vintage"
fetch('theme/vintage.json')
  .then(r => r.json())
  .then(theme => {
    echarts.registerTheme('vintage', theme);
    var chart = echarts.init(dom, 'vintage');
  })
```

如果保存为 UMD 格式的 JS 文件，文件内部已经做了自注册，直接引入 JS 即可：

```javascript
// HTML 引入 vintage.js 文件后（假设主题名称是 "vintage"）
var chart = echarts.init(dom, 'vintage');
// ...
```

### 调色盘

调色盘，可以在 option 中设置。它给定了一组颜色，图形、系列会自动从其中选择颜色。可以设置全局的调色盘，也可以设置系列自己专属的调色盘。

```javascript
option = {
  // 全局调色盘。
  color: [
    '#c23531',
    '#2f4554',
    '#61a0a8',
    '#d48265',
    '#91c7ae',
    '#749f83',
    '#ca8622',
    '#bda29a',
    '#6e7074',
    '#546570',
    '#c4ccd3'
  ],

  series: [
    {
      type: 'bar',
      // 此系列自己的调色盘。
      color: [
        '#dd6b66',
        '#759aa0',
        '#e69d87',
        '#8dc1a9',
        '#ea7e53',
        '#eedd78',
        '#73a373',
        '#73b9bc',
        '#7289ab',
        '#91ca8c',
        '#f49f42'
      ]
      // ...
    },
    {
      type: 'pie',
      // 此系列自己的调色盘。
      color: [
        '#37A2DA',
        '#32C5E9',
        '#67E0E3',
        '#9FE6B8',
        '#FFDB5C',
        '#ff9f7f',
        '#fb7293',
        '#E062AE',
        '#E690D1',
        '#e7bcf3',
        '#9d96f5',
        '#8378EA',
        '#96BFFF'
      ]
      // ...
    }
  ]
};
```

### 直接的样式设置

直接的样式设置是比较常用设置方式。纵观 ECharts 的 option 中，很多地方可以设置 itemStyle、lineStyle、areaStyle、label 等等。这些的地方可以直接设置图形元素的颜色、线宽、点的大小、标签的文字、标签的样式等等。

一般来说，ECharts 的各个系列和组件，都遵从这些命名习惯，虽然不同图表和组件中，`itemStyle`、`label` 等可能出现在不同的地方。

### 高亮的样式：emphasis

在鼠标悬浮到图形元素上时，一般会出现高亮的样式。默认情况下，高亮的样式是根据普通样式自动生成的。但是高亮的样式也可以自己定义，主要是通过 emphasis 属性来定制。emphasis 中的结构，和普通样式的结构相同，例如：

```javascript
option = {
  series: {
    type: 'scatter',

    // 普通样式。
    itemStyle: {
      // 点的颜色。
      color: 'red'
    },
    label: {
      show: true,
      // 标签的文字。
      formatter: 'This is a normal label.'
    },

    // 高亮样式。
    emphasis: {
      itemStyle: {
        // 高亮时点的颜色。
        color: 'blue'
      },
      label: {
        show: true,
        // 高亮时标签的文字。
        formatter: 'This is a emphasis label.'
      }
    }
  }
};
```

### 通过 visualMap 组件设定样式

visualMap 组件能指定数据到颜色、图形尺寸的映射规则，详见数据的视觉映射。

---

## 数据集

`数据集（dataset）`是专门用来管理数据的组件。虽然每个系列都可以在 `series.data` 中设置数据，但是从 ECharts4 支持数据集开始，更推荐使用数据集来管理数据。因为这样，数据可以被多个组件复用，也方便进行 "数据和其他配置" 分离的配置风格。毕竟，在运行时，数据是最常改变的，而其他配置大多并不会改变。

### 在数据集中设置数据

而数据设置在 `数据集（dataset）` 中，会有这些好处：

- 能够贴近数据可视化常见思维方式：（I）提供数据，（II）指定数据到视觉的映射，从而形成图表。
- 数据和其他配置可以被分离开来。数据常变，其他配置常不变。分开易于分别管理。
- 数据可以被多个系列或者组件复用，对于大数据量的场景，不必为每个系列创建一份数据。
- 支持更多的数据的常用格式，例如二维数组、对象数组等，一定程度上避免使用者为了数据格式而进行转换。

下面是一个最简单的 `dataset` 的例子：

```javascript
option = {
  legend: {},
  tooltip: {},
  dataset: {
    // 提供一份数据。
    source: [
      ['product', '2015', '2016', '2017'],
      ['Matcha Latte', 43.3, 85.8, 93.7],
      ['Milk Tea', 83.1, 73.4, 55.1],
      ['Cheese Cocoa', 86.4, 65.2, 82.5],
      ['Walnut Brownie', 72.4, 53.9, 39.1]
    ]
  },
  // 声明一个 X 轴，类目轴（category）。默认情况下，类目轴对应到 dataset 第一列。
  xAxis: { type: 'category' },
  // 声明一个 Y 轴，数值轴。
  yAxis: {},
  // 声明多个 bar 系列，默认情况下，每个系列会自动对应到 dataset 的每一列。
  series: [{ type: 'bar' }, { type: 'bar' }, { type: 'bar' }]
};
```

或者也可以使用常见的"对象数组"的格式：

```javascript
option = {
  legend: {},
  tooltip: {},
  dataset: {
    // 用 dimensions 指定了维度的顺序。直角坐标系中，如果 X 轴 type 为 category，
    // 默认把第一个维度映射到 X 轴上，后面维度映射到 Y 轴上。
    // 如果不指定 dimensions，也可以通过指定 series.encode
    // 完成映射，参见后文。
    dimensions: ['product', '2015', '2016', '2017'],
    source: [
      { product: 'Matcha Latte', '2015': 43.3, '2016': 85.8, '2017': 93.7 },
      { product: 'Milk Tea', '2015': 83.1, '2016': 73.4, '2017': 55.1 },
      { product: 'Cheese Cocoa', '2015': 86.4, '2016': 65.2, '2017': 82.5 },
      { product: 'Walnut Brownie', '2015': 72.4, '2016': 53.9, '2017': 39.1 }
    ]
  },
  xAxis: { type: 'category' },
  yAxis: {},
  series: [{ type: 'bar' }, { type: 'bar' }, { type: 'bar' }]
};
```

### 数据到图形的映射

如上所述，数据可视化的一个常见思路是：（I）提供数据，（II）指定数据到视觉的映射。

简而言之，可以进行这些映射的设定：

- 指定 `数据集` 的列（column）还是行（row）映射为 `系列（series）`。这件事可以使用 series.seriesLayoutBy 属性来配置。默认是按照列（column）来映射。
- 指定维度映射的规则：如何从 dataset 的维度（一个"维度"的意思是一行/列）映射到坐标轴（如 X、Y 轴）、提示框（tooltip）、标签（label）、图形元素大小颜色等（visualMap）。这件事可以使用 series.encode 属性，以及 visualMap 组件来配置（如果有需要映射颜色大小等视觉维度的话）。

### 数据的各种格式

多数常见图表中，数据适于用二维表的形式描述。广为使用的数据表格软件（如 MS Excel、Numbers）或者关系数据数据库都是二维表。他们的数据可以导出成 JSON 格式，输入到 `dataset.source` 中，在不少情况下可以免去一些数据处理的步骤。

除了二维数组以外，dataset 也支持例如下面 key-value 方式的数据格式，这类格式也非常常见。但是这类格式中，目前并不支持 seriesLayoutBy 参数。

```javascript
dataset: [
  {
    // 按行的 key-value 形式（对象数组），这是个比较常见的格式。
    source: [
      { product: 'Matcha Latte', count: 823, score: 95.8 },
      { product: 'Milk Tea', count: 235, score: 81.4 },
      { product: 'Cheese Cocoa', count: 1042, score: 91.2 },
      { product: 'Walnut Brownie', count: 988, score: 76.9 }
    ]
  },
  {
    // 按列的 key-value 形式。
    source: {
      product: ['Matcha Latte', 'Milk Tea', 'Cheese Cocoa', 'Walnut Brownie'],
      count: [823, 235, 1042, 988],
      score: [95.8, 81.4, 91.2, 76.9]
    }
  }
];
```

---

## 常用图表类型

### 基础柱状图

柱状图（或称条形图）是一种通过柱形的长度来表现数据大小的一种常用图表类型。

设置柱状图的方式，是将 `series` 的 `type` 设为 `'bar'`。

#### 最简单的柱状图

最简单的柱状图可以这样设置：

```javascript
option = {
  xAxis: {
    data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  },
  yAxis: {},
  series: [
    {
      type: 'bar',
      data: [23, 24, 18, 25, 27, 28, 25]
    }
  ]
};
```

在这个例子中，横坐标是类目型的，因此需要在 `xAxis` 中指定对应的值；而纵坐标是数值型的，可以根据 `series` 中的 `data`，自动生成对应的坐标范围。

#### 多系列的柱状图

我们可以用一个系列表示一组相关的数据，如果需要实现多系列的柱状图，只需要在 `series` 多添加一项就可以了：

```javascript
option = {
  xAxis: {
    data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  },
  yAxis: {},
  series: [
    {
      type: 'bar',
      data: [23, 24, 18, 25, 27, 28, 25]
    },
    {
      type: 'bar',
      data: [26, 24, 18, 22, 23, 20, 27]
    }
  ]
};
```

#### 柱条样式

柱条的样式可以通过 `series.itemStyle` 设置，包括：

- 柱条的颜色（`color`）；
- 柱条的描边颜色（`borderColor`）、宽度（`borderWidth`）、样式（`borderType`）；
- 柱条圆角的半径（`barBorderRadius`）；
- 柱条透明度（`opacity`）；
- 阴影（`shadowBlur`、`shadowColor`、`shadowOffsetX`、`shadowOffsetY`）。

```javascript
option = {
  xAxis: {
    data: ['A', 'B', 'C', 'D', 'E']
  },
  yAxis: {},
  series: [
    {
      type: 'bar',
      data: [
        10,
        22,
        28,
        {
          value: 43,
          // 设置单个柱子的样式
          itemStyle: {
            color: '#91cc75',
            shadowColor: '#91cc75',
            borderType: 'dashed',
            opacity: 0.5
          }
        },
        49
      ],
      itemStyle: {
        barBorderRadius: 5,
        borderWidth: 1,
        borderType: 'solid',
        borderColor: '#73c0de',
        shadowColor: '#5470c6',
        shadowBlur: 3
      }
    }
  ]
};
```

#### 柱条宽度和高度

柱条宽度可以通过 `barWidth` 设置。比如在下面的例子中，将 `barWidth` 设为 `'20%'`，表示每个柱条的宽度就是类目宽度的 20%。由于这个例子中，每个系列有 5 个数据，20% 的类目宽度也就是整个 x 轴宽度的 4%。

```javascript
option = {
  xAxis: {
    data: ['A', 'B', 'C', 'D', 'E']
  },
  yAxis: {},
  series: [
    {
      type: 'bar',
      data: [10, 22, 28, 43, 49],
      barWidth: '20%'
    }
  ]
};
```

另外，还可以设置 `barMaxWidth` 限制柱条的最大宽度。对于一些特别小的数据，我们也可以为柱条指定最小高度 `barMinHeight`，当数据对应的柱条高度小于该值时，柱条高度将采用这个最小高度。

#### 柱条间距

柱条间距分为两种，一种是不同系列在同一类目下的距离 `barGap`，另一种是类目与类目的距离 `barCategoryGap`。

```javascript
option = {
  xAxis: {
    data: ['A', 'B', 'C', 'D', 'E']
  },
  yAxis: {},
  series: [
    {
      type: 'bar',
      data: [23, 24, 18, 25, 18],
      barGap: '20%',
      barCategoryGap: '40%'
    },
    {
      type: 'bar',
      data: [12, 14, 9, 9, 11]
    }
  ]
};
```

在这个例子中，`barGap` 被设为 `'20%'`，这意味着每个类目（比如 `A`）下的两个柱子之间的距离，相对于柱条宽度的百分比。而 `barCategoryGap` 是 `'40%'`，意味着柱条每侧空余的距离，相对于柱条宽度的百分比。

通常而言，设置 `barGap` 及 `barCategoryGap` 后，就不需要设置 `barWidth` 了，这时候的宽度会自动调整。如果有需要的话，可以设置 `barMaxWidth` 作为柱条宽度的上限，当图表宽度很大的时候，柱条宽度也不会太宽。

---

### 基础折线图

折线图主要用来展示数据项随着时间推移的趋势或变化。

#### 最简单的折线图

如果我们想建立一个横坐标是类目型（category）、纵坐标是数值型（value）的折线图，我们可以使用这样的方式：

```javascript
option = {
  xAxis: {
    type: 'category',
    data: ['A', 'B', 'C']
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      data: [120, 200, 150],
      type: 'line'
    }
  ]
};
```

在这个例子中，我们通过 `xAxis` 将横坐标设为类目型，并指定了对应的值；通过 `type` 将 `yAxis` 的类型设定为数值型。在 `series` 中，我们将系列类型设为 `line`，并且通过 `data` 指定了折线图三个点的取值。这样，就能得到一个最简单的折线图了。

#### 笛卡尔坐标系中的折线图

如果我们希望折线图在横坐标和纵坐标上都是连续的，即在笛卡尔坐标系中，应该如何实现呢？答案也很简单，只要把 `series` 的 `data` 每个数据用一个包含两个元素的数组表示就行了。

```javascript
option = {
  xAxis: {},
  yAxis: {},
  series: [
    {
      data: [
        [20, 120],
        [50, 200],
        [40, 50]
      ],
      type: 'line'
    }
  ]
};
```

#### 折线图样式设置

##### 折线的样式

折线图中折线的样式可以通过 `lineStyle` 设置。可以为其指定颜色、线宽、折线类型、阴影、不透明度等等，具体的可以参考配置项手册 series.lineStyle 了解。这里，我们以设置颜色（color）、线宽（width）和折线类型（type）为例说明。

```javascript
option = {
  xAxis: {
    data: ['A', 'B', 'C', 'D', 'E']
  },
  yAxis: {},
  series: [
    {
      data: [10, 22, 28, 23, 19],
      type: 'line',
      lineStyle: {
        normal: {
          color: 'green',
          width: 4,
          type: 'dashed'
        }
      }
    }
  ]
};
```

这里设置折线宽度时，数据点描边的宽度是不会跟着改变的，而应该在数据点的配置项中另外设置。

##### 数据点的样式

数据点的样式可以通过 `series.itemStyle` 指定填充颜色（color）、描边颜色（borderColor）、描边宽度（borderWidth）、描边类型（borderType）、阴影（shadowColor）、不透明度（opacity）等。与折线样式的设置十分相似，这里不再展开说明。

#### 在数据点处显示数值

在系列中，这数据点的标签通过 `series.label` 属性指定。如果将 `label` 下的 `show` 指定为`true`，则表示该数值默认时就显示；如果为 `false`，而 `series.emphasis.label.show` 为 `true`，则表示只有在鼠标移动到该数据时，才显示数值。

```javascript
option = {
  xAxis: {
    data: ['A', 'B', 'C', 'D', 'E']
  },
  yAxis: {},
  series: [
    {
      data: [10, 22, 28, 23, 19],
      type: 'line',
      label: {
        show: true,
        position: 'bottom',
        textStyle: {
          fontSize: 20
        }
      }
    }
  ]
};
```

#### 空数据

在一个系列中，可能一个横坐标对应的取值是"空"的，将其设为 0 有时并不能满足我们的期望--空数据不应被其左右的数据连接。

在 ECharts 中，我们使用字符串 `'-'` 表示空数据，这对其他系列的数据也是适用的。

```javascript
option = {
  xAxis: {
    data: ['A', 'B', 'C', 'D', 'E']
  },
  yAxis: {},
  series: [
    {
      data: [0, 22, '-', 23, 19],
      type: 'line'
    }
  ]
};
```

> 注意区别这个例子中，"空"数据与取值为 0 的数据。

---

### 基础饼图

饼图主要用于表现不同类目的数据在总和中的占比。每个的弧度表示数据数量的比例。

#### 最简单的饼图

饼图的配置和折线图、柱状图略有不同，不再需要配置坐标轴，而是把数据名称和值都写在系列中。以下是一个最简单的饼图的例子。

```javascript
option = {
  series: [
    {
      type: 'pie',
      data: [
        {
          value: 335,
          name: '直接访问'
        },
        {
          value: 234,
          name: '联盟广告'
        },
        {
          value: 1548,
          name: '搜索引擎'
        }
      ]
    }
  ]
};
```

需要注意的是，这里是 `value` 不需要是百分比数据，ECharts 会根据所有数据的 `value`，按比例分配它们在饼图中对应的弧度。

#### 饼图样式设置

##### 饼图的半径

饼图的半径可以通过 `series.radius` 设置，可以是诸如 `'60%'` 这样相对的百分比字符串，或是 `200` 这样的绝对像素数值。当它是百分比字符串时，它是相对于容器宽高中较小的一条边的。也就是说，如果宽度大于高度，则百分比是相对于高度的，反之则反；当它是数值型时，它表示绝对的像素大小。

```javascript
option = {
  series: [
    {
      type: 'pie',
      data: [
        {
          value: 335,
          name: '直接访问'
        },
        {
          value: 234,
          name: '联盟广告'
        },
        {
          value: 1548,
          name: '搜索引擎'
        }
      ],
      radius: '50%'
    }
  ]
};
```

#### 如果数据和为 0，不显示饼图

在默认情况下，如果数据值和为 0，会显示平均分割的扇形。比如，如果有 4 个数据项，并且每个数据项都是 0，则每个扇形都是 90°。如果我们希望在这种情况下不显示任何扇形，可以将 `series.stillShowZeroSum` 设为 `false`。

```javascript
option = {
  series: [
    {
      type: 'pie',
      stillShowZeroSum: false,
      data: [
        {
          value: 0,
          name: '直接访问'
        },
        {
          value: 0,
          name: '联盟广告'
        },
        {
          value: 0,
          name: '搜索引擎'
        }
      ]
    }
  ]
};
```

---

## 参考资源

- 官方网站：https://echarts.apache.org
- 使用手册：https://echarts.apache.org/handbook/zh/
- 配置项手册：https://echarts.apache.org/zh/option.html
- API 文档：https://echarts.apache.org/zh/api.html
- 示例集合：https://echarts.apache.org/examples/zh/index.html
- 主题构建工具：https://echarts.apache.org/zh/theme-builder.html
- 下载页面：https://echarts.apache.org/zh/download.html
