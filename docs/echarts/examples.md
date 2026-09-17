# ECharts 常用示例代码

> 本文档收集了 ECharts 常用图表的示例代码，供快速参考。

---

## 目录

1. [基础柱状图](#基础柱状图)
2. [多系列柱状图](#多系列柱状图)
3. [堆叠柱状图](#堆叠柱状图)
4. [基础折线图](#基础折线图)
5. [平滑折线图](#平滑折线图)
6. [面积折线图](#面积折线图)
7. [基础饼图](#基础饼图)
8. [圆环图](#圆环图)
9. [基础散点图](#基础散点图)
10. [仪表盘](#仪表盘)
11. [雷达图](#雷达图)
12. [地图](#地图)

---

## 基础柱状图

```javascript
option = {
  xAxis: {
    type: 'category',
    data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      data: [120, 200, 150, 80, 70, 110, 130],
      type: 'bar',
      showBackground: true,
      backgroundStyle: {
        color: 'rgba(220, 220, 220, 0.8)'
      }
    }
  ]
};
```

---

## 多系列柱状图

```javascript
option = {
  legend: {},
  tooltip: {},
  xAxis: {
    type: 'category',
    data: ['Q1', 'Q2', 'Q3', 'Q4']
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      name: '2015',
      type: 'bar',
      data: [43.3, 85.8, 93.7, 85.4]
    },
    {
      name: '2016',
      type: 'bar',
      data: [83.1, 73.4, 55.1, 53.3]
    },
    {
      name: '2017',
      type: 'bar',
      data: [86.4, 65.2, 82.5, 39.1]
    }
  ]
};
```

---

## 堆叠柱状图

```javascript
option = {
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'shadow'
    }
  },
  legend: {},
  grid: {
    left: '3%',
    right: '4%',
    bottom: '3%',
    containLabel: true
  },
  xAxis: [
    {
      type: 'category',
      data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    }
  ],
  yAxis: [
    {
      type: 'value'
    }
  ],
  series: [
    {
      name: 'Email',
      type: 'bar',
      stack: 'Ad',
      emphasis: {
        focus: 'series'
      },
      data: [120, 132, 101, 134, 90, 230, 210]
    },
    {
      name: 'Union Ads',
      type: 'bar',
      stack: 'Ad',
      emphasis: {
        focus: 'series'
      },
      data: [220, 182, 191, 234, 290, 330, 310]
    },
    {
      name: 'Video Ads',
      type: 'bar',
      stack: 'Ad',
      emphasis: {
        focus: 'series'
      },
      data: [150, 232, 201, 154, 190, 330, 410]
    }
  ]
};
```

---

## 基础折线图

```javascript
option = {
  xAxis: {
    type: 'category',
    data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      data: [150, 230, 224, 218, 135, 147, 260],
      type: 'line'
    }
  ]
};
```

---

## 平滑折线图

```javascript
option = {
  xAxis: {
    type: 'category',
    data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      data: [150, 230, 224, 218, 135, 147, 260],
      type: 'line',
      smooth: true
    }
  ]
};
```

---

## 面积折线图

```javascript
option = {
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      data: [820, 932, 901, 934, 1290, 1330, 1320],
      type: 'line',
      areaStyle: {}
    }
  ]
};
```

---

## 基础饼图

```javascript
option = {
  series: [
    {
      type: 'pie',
      radius: '50%',
      data: [
        { value: 335, name: '直接访问' },
        { value: 310, name: '邮件营销' },
        { value: 234, name: '联盟广告' },
        { value: 135, name: '视频广告' },
        { value: 1548, name: '搜索引擎' }
      ],
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowOffsetX: 0,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      }
    }
  ]
};
```

---

## 圆环图

```javascript
option = {
  series: [
    {
      type: 'pie',
      radius: ['40%', '70%'],
      avoidLabelOverlap: false,
      itemStyle: {
        borderRadius: 10,
        borderColor: '#fff',
        borderWidth: 2
      },
      label: {
        show: false,
        position: 'center'
      },
      emphasis: {
        label: {
          show: true,
          fontSize: 40,
          fontWeight: 'bold'
        }
      },
      labelLine: {
        show: false
      },
      data: [
        { value: 1048, name: 'Search Engine' },
        { value: 735, name: 'Direct' },
        { value: 580, name: 'Email' },
        { value: 484, name: 'Union Ads' },
        { value: 300, name: 'Video Ads' }
      ]
    }
  ]
};
```

---

## 基础散点图

```javascript
option = {
  xAxis: {},
  yAxis: {},
  series: [
    {
      symbolSize: 20,
      data: [
        [10.0, 8.04],
        [8.0, 6.95],
        [13.0, 7.58],
        [9.0, 8.81],
        [11.0, 8.33],
        [14.0, 9.96],
        [6.0, 7.24],
        [4.0, 4.26],
        [12.0, 10.84],
        [7.0, 4.82],
        [5.0, 5.68]
      ],
      type: 'scatter'
    }
  ]
};
```

---

## 仪表盘

```javascript
option = {
  series: [
    {
      type: 'gauge',
      progress: {
        show: true,
        width: 18
      },
      axisLine: {
        lineStyle: {
          width: 18
        }
      },
      axisTick: {
        show: false
      },
      splitLine: {
        length: 15,
        lineStyle: {
          width: 2,
          color: '#999'
        }
      },
      pointer: {
        icon: 'path://M12.8,0.7l12,40.1H0.7L12.8,0.7z',
        length: '12%',
        width: 20,
        offsetCenter: [0, '-60%'],
        itemStyle: {
          color: 'auto'
        }
      },
      axisLabel: {
        color: '#464646',
        distance: 25,
        fontSize: 14
      },
      title: {
        offsetCenter: [0, '-20%'],
        fontSize: 16
      },
      detail: {
        fontSize: 30,
        offsetCenter: [0, '0%'],
        valueAnimation: true,
        formatter: function(value) {
          return Math.round(value) + '%';
        },
        color: 'auto'
      },
      data: [
        {
          value: 70,
          name: '完成率'
        }
      ]
    }
  ]
};
```

---

## 雷达图

```javascript
option = {
  title: {
    text: '预算 vs 开销'
  },
  legend: {
    data: ['预算分配', '实际开销']
  },
  radar: {
    shape: 'circle',
    indicator: [
      { name: '销售', max: 6500 },
      { name: '管理', max: 16000 },
      { name: '信息技术', max: 30000 },
      { name: '客服', max: 38000 },
      { name: '研发', max: 52000 },
      { name: '市场', max: 25000 }
    ]
  },
  series: [
    {
      name: '预算 vs 开销',
      type: 'radar',
      data: [
        {
          value: [4200, 3000, 20000, 35000, 50000, 18000],
          name: '预算分配'
        },
        {
          value: [5000, 14000, 28000, 26000, 42000, 21000],
          name: '实际开销'
        }
      ]
    }
  ]
};
```

---

## 地图

```javascript
// 需要额外引入中国地图数据
// import chinaMap from '../data/china.json';
// echarts.registerMap('china', chinaMap);

option = {
  geo: {
    map: 'china',
    roam: true,
    label: {
      show: true,
      fontSize: 10
    },
    itemStyle: {
      areaColor: '#eee',
      borderColor: '#333'
    },
    emphasis: {
      itemStyle: {
        areaColor: '#ccc'
      },
      label: {
        show: true
      }
    }
  },
  series: [
    {
      type: 'scatter',
      coordinateSystem: 'geo',
      data: [
        { name: '北京', value: [116.46, 39.92, 100] },
        { name: '上海', value: [121.48, 31.22, 200] },
        { name: '广州', value: [113.23, 23.16, 300] }
      ],
      symbolSize: function(val) {
        return val[2] / 10;
      },
      encode: {
        value: 2
      },
      label: {
        formatter: '{b}',
        position: 'right',
        show: false
      },
      emphasis: {
        label: {
          show: true
        }
      }
    }
  ]
};
```

---

## 常用配置项速查

### 基础配置

```javascript
option = {
  // 标题
  title: {
    text: '主标题',
    subtext: '副标题',
    left: 'center'
  },
  
  // 提示框
  tooltip: {
    trigger: 'axis'  // 'item' | 'axis' | 'none'
  },
  
  // 图例
  legend: {
    data: ['系列1', '系列2'],
    orient: 'vertical',  // 'horizontal' | 'vertical'
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
    data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    axisLabel: {
      rotate: 0
    }
  },
  
  // Y轴
  yAxis: {
    type: 'value',
    min: 0,
    max: 100
  },
  
  // 数据缩放
  dataZoom: [
    {
      type: 'inside',
      start: 0,
      end: 100
    },
    {
      type: 'slider',
      start: 0,
      end: 100
    }
  ],
  
  // 工具栏
  toolbox: {
    feature: {
      saveAsImage: {},
      dataZoom: {},
      restore: {},
      dataView: {}
    }
  },
  
  // 系列
  series: [
    {
      name: '系列1',
      type: 'bar',
      data: [120, 200, 150, 80, 70, 110, 130],
      itemStyle: {
        color: '#5470c6'
      }
    }
  ]
};
```

---

## 事件处理

```javascript
// 监听点击事件
myChart.on('click', function(params) {
  console.log(params.name, params.value);
});

// 监听双击事件
myChart.on('dblclick', function(params) {
  console.log(params);
});

// 监听鼠标移入
myChart.on('mouseover', function(params) {
  console.log(params);
});

// 监听图例选择
myChart.on('legendselectchanged', function(params) {
  console.log(params.selected);
});

// 监听数据区域缩放
myChart.on('datazoom', function(params) {
  console.log(params);
});
```

---

## 动态数据更新

```javascript
// 基础更新
myChart.setOption({
  series: [
    {
      data: [1, 2, 3, 4, 5]
    }
  ]
});

// 增量更新（不替换已有配置）
myChart.setOption({
  series: [
    {
      data: [5, 4, 3, 2, 1]
    }
  ]
}, false);  // 第二个参数为 false 表示增量更新

// 动态模拟数据
setInterval(function() {
  var data = option.series[0].data;
  data.shift();
  data.push(Math.round(Math.random() * 100));
  myChart.setOption({
    series: [{
      data: data
    }]
  });
}, 1000);
```

---

## 响应式图表

```javascript
// 监听窗口大小变化
window.addEventListener('resize', function() {
  myChart.resize();
});

// 使用 ResizeObserver（更精确）
const resizeObserver = new ResizeObserver(entries => {
  for (let entry of entries) {
    myChart.resize();
  }
});
resizeObserver.observe(document.getElementById('main'));

// 容器销毁时释放资源
function destroyChart() {
  myChart.dispose();
  myChart = null;
}
```
