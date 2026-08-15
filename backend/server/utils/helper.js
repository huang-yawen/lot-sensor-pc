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

/**
 * 解析字段映射表里 value_map 列存的 JSON 文本，格式不对就当作没配置，不影响其他字段。
 */
exports.parseValueMap = (raw) => {
    const text = String(raw || '').trim();
    if (!text) return null;
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * 把数据库原始值换成字段映射表里配置的展示文案（比如 "0" -> "关"，"1" -> "开"）。
 * 只在查询返回时转换显示值，不改数据库里存的原始值。
 * @param {Array<Object>} data - 查询结果行（已经按 fieldMapping 把列名改成中文/展示名）
 * @param {Object} fieldMapping - { db_name: 展示名 }
 * @param {Object} valueMaps - { db_name: { 原始值: 展示文案 } }，某字段没配置就原样保留
 */
exports.applyValueLabels = (data, fieldMapping, valueMaps) => {
    return data.map(item => {
        Object.keys(fieldMapping).forEach(key => {
            const label = fieldMapping[key];
            const map = valueMaps[key];
            if (!map || item[label] == null) return;
            const raw = String(item[label]).trim();
            if (Object.prototype.hasOwnProperty.call(map, raw)) {
                item[label] = map[raw];
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
