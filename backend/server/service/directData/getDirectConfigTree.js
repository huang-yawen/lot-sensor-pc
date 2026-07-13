const promisePool = require('../../config/dbPool')

// 把扁平的指令配置表转成页面要用的树形结构。
module.exports = async function getDirectConfigTree() {
    const [data] = await promisePool.query(
        'SELECT id, ref_id, ref_value, t_name, f_type, f_value, max, min, `order` FROM t_direct_config'
    )

    const buildTree = (arr = data, id = null) => {
        const children = arr.filter((item) => item.ref_id === id)
        const grouped = {}

        children.forEach((item) => {
            const whenValue = item.ref_value
            if (!grouped[whenValue]) {
                grouped[whenValue] = []
            }

            item.children = buildTree(arr, item.id)
            grouped[whenValue].push(item)
        })

        return grouped
    }

    const treeData = buildTree(data, null)
    return {
        success: true,
        data: treeData['null'],
    }
}
