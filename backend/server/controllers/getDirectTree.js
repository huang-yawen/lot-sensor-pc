const promisePool = require('../config/promisepool')
const { formatDataWithUnit } = require('../utils/helper')

module.exports= async (req, res) => {
    try {
        const [data] = await promisePool.query(`select id,ref_id,ref_value,t_name,f_type,f_value,max,min,\`order\` from t_direct_config`)

        const beTree = (arr = data, id = null) => {
            let newArr = arr.filter(item => item.ref_id === id)
            const grouped = {};
            newArr.forEach(item => {
                const whenValue = item.ref_value;
                if (!grouped[whenValue]) {
                    grouped[whenValue] = [];
                }
                item.children = beTree(arr, item.id);
                grouped[whenValue].push(item);
            });

            // 数据分组的常用模板
            // const grouped = {};
            // 数据数组.forEach(对象 => {
            // const 分类依据 = 对象.某个属性;
            // if (!grouped[分类依据]) grouped[分类依据] = [];
            // grouped[分类依据].push(对象);
            // });

            /**
             * 数据分组通用模式：
             * 1. 创建空对象用于存储分组结果
             * 2. 遍历一群对象（一般有一个数组装起来），提取每个对象的分类依据值
             * 3. 检查分组对象中是否存在该分类键：
             *    - 若不存在，先创建空数组作为初始值
             *    - 若存在，直接将当前对象追加到对应数组中
             * 4. 最终得到按指定属性分类的对象结构
             * 
             * 适用场景：按状态、类型、部门等属性对对象数组进行分类
             */
            return grouped;
        }

        const treeData = beTree(data, null)

        console.log(JSON.stringify(treeData, null, 2))

        res.json({
            success: true,
            data: treeData['null']
        })
    } catch (err) {
        if (err) {
            console.log("directData出错啦：" + err)
            res.status(500).json({
                success: false,
                message: "获取数据失败"
            })
        }
    }
}