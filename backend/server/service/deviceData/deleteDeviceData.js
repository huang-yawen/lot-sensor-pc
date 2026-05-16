const promisePool = require('../../config/promisepool')
const { formatDataWithUnit } = require('../../utils/helper')

module.exports= async (req, res) => {
    try {
        const id = req.body.id
        const deleteId = Number(id)
        await promisePool.execute(`DELETE FROM \`t_device\` WHERE \`id\` = ?;`, [deleteId])
        res.json({
            success: true
        })
    } catch (err) {
        if (err) {
            console.log("获取请求失败了" + err)
        }
        res.status(500).json({
            success: false,
            message: '删除失败：' + err.message
        })
    }
}