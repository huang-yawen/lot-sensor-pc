const promisePool = require('../../config/promisepool')
const { formatDataWithUnit } = require('../../utils/helper')

module.exports= async (req, res) => {
    try {
        const request = req.body
        await promisePool.execute(`insert into \`t_device\` (id,device_name,remarks,ctime,number) 
            values(?,?,?,?,?)`, [Number(request.id), request['设备名称'], request['备注'], request['创立时间'], request['电车编号id']])
        res.json({
            success: true,
            message: "成功啦！"
        })
    }
    catch (err) {
        console.log("device加入数据出错：", err);
        return res.json({
            success: false,
            message: "后端执行失败：" + err.message
        });
    }
}