const promisePool = require('../config/promisepool')
const { formatDataWithUnit } = require('../utils/helper')

module.exports= async (req, res) => {
    try {
        const onlineFilter = req.query.online;
        
        // 获取字段映射
        const [fieldMapper] = await promisePool.query(
            `SELECT f_name,db_name,unit FROM t_sensor_field_mapper WHERE visible = 1`
        );
        const fieldMapping = {};
        const fieldUnit = {}
        fieldMapper.forEach(item => {
            fieldMapping[item.db_name] = item.f_name;
            fieldUnit[item.db_name] = item.unit
        });

        const searchMapper = ['id', 'd_no AS 设备编号'];
        for (let key in fieldMapping) {
            searchMapper.push(`${key} AS \`${fieldMapping[key]}\``);
        }
        searchMapper.push('c_time AS 创立时间');

        let whereClause = '';
        let params = [];
        if (onlineFilter) {
            whereClause = ' WHERE online = ?';
            params = [onlineFilter];
        }

        const [sensorData] = await promisePool.query(
            `SELECT ${searchMapper.join(',')} FROM t_sensor_data${whereClause} ORDER BY id`,
            params
        );

        const proccessData = formatDataWithUnit(sensorData, fieldMapping, fieldUnit)
        // t_error_msg
        const [errorMapper] = await promisePool.query('select id ,d_no as `设备编号`,c_time as `更新时间`,e_msg as `故障原因` from t_error_msg')
        console.log(errorMapper)
        const sortedData = errorMapper.reduce((acc, item) => {
            const deviceNo = item.设备编号;
            if (!acc[deviceNo]) acc[deviceNo] = [];
            acc[deviceNo].push(item);
            return acc;
        }, {})

        //t_behavior_data
        const fieldName = {};
        const [behaviorField] = await promisePool.query('select db_name,p_name from t_behavior_field_mapper')
        behaviorField.forEach(item => {
            fieldName[item.db_name] = item.p_name;
        });

        const searchBehavior = ['id', 'd_no AS 设备编号'];
        Object.keys(fieldName).forEach(key => {
            searchBehavior.push(`${key} AS \`${fieldName[key]}\``);
        });
        searchBehavior.push(`online AS 数据类型`);
        searchBehavior.push(`field5 AS 更新时间`);

        let [behaviorOutcome] = await promisePool.query(
            `SELECT ${searchBehavior.join(',')} FROM t_behavior_data`
        );
        behaviorOutcome = behaviorOutcome.map(item => {
            for (let key in fieldName) {
                const label = fieldName[key]
                const unit = fieldUnit[key]
                if (unit) {
                    item[label] = `${item[label]} ${unit}`
                }
            }
            return item
            // 如果在内层循环里面return ，会导致每次都只有对象里面的第一个字段拥有单位,变量会出错
        })
        console.log(behaviorOutcome)

        res.json({
            success: true,
            message: '成功了',
            proccessData,
            sortedData,
            behaviorOutcome
        });
    } catch (err) {
        console.error('处理失败:', err);
        res.status(500).send('数据处理失败');
    }
}