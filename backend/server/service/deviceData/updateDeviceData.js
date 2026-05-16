const promisePool = require('../../config/promisepool')
const { formatDataWithUnit } = require('../../utils/helper')

module.exports = async (req, res) => {
    try {
        const data = req.body;

        const oldId = Number(data.oldId);

        const newId = Number(data.id);
        const deviceName = data['设备名称'] ?? '';
        const number = data['电车编号id'] ?? '';
        const remarks = data['备注'] ?? null;

        if (isNaN(oldId)) {
            return res.json({ success: false, message: "oldId 无效" });
        }
        if (!deviceName || !number) {
            return res.json({ success: false, message: "设备名称和电车编号id 不能为空" });
        }
        const params = [
            deviceName,
            number,
            remarks,
            newId,
            oldId
        ];

        const [result] = await promisePool.execute(
            `UPDATE t_device SET 
                device_name = ?, 
                number = ?,
                remarks = ?,
                id =?
             WHERE id = ?`,
            params
        );

        if (result.affectedRows === 0) {
            return res.json({
                success: false,
                message: "未找到该设备，或数据未变化"
            });
        }

        res.json({ success: true, message: "修改成功！" });

    } catch (err) {
        console.log("更新设备失败：", err);
        res.json({
            success: false,
            message: "修改失败：" + err.message
        });
    }
};