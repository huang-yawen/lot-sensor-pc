/** 【文件职责】通用格式化工具集合。
 * 【配置中心关联】无直接读取；调用方传入所需映射。 */
exports.formatDataWithUnit = (data, fieldMapping, fieldUnit) => {
    return data.map(item => {
        Object.keys(fieldMapping).forEach(key => {
            const label = fieldMapping[key];
            const unit = fieldUnit[key];
            if (unit && item[label] != null) {
                item[label] = `${item[label]} ${unit}`;
            }
        });
        return item;
    });
}

exports.buildDisplayFieldUnits = (fieldMapping, fieldUnit) => {
    const units = {};
    Object.keys(fieldMapping).forEach(key => {
        const label = fieldMapping[key];
        const unit = fieldUnit[key];
        if (label && unit) {
            units[label] = unit;
        }
    });
    return units;
}
/**
 * 【文件职责】后端通用小工具集合，放置与具体业务无关的格式化、转换或校验函数。
 * 【配置中心关联】无直接读取；若某工具需要场景配置，应由调用方显式传入，避免隐式耦合。
 */
