/** 【文件职责】通用格式化工具集合。
 * 【配置中心关联】无直接读取；调用方传入所需映射。 */

/**
 * 将日期/时间戳格式化为本地时间字符串（MySQL DATETIME 格式）
 * 【重要】使用本地时区（getFullYear/getHours），避免 toISOString() 导致的 UTC 时差问题
 * toISOString() 返回格林威治时间（UTC），会比北京时间慢 8 小时
 *
 * @param {Date|string|number|null|undefined} date - 日期对象、字符串、时间戳
 * @returns {string|null} 'YYYY-MM-DD HH:mm:ss' 格式，无效值返回 null
 */
function formatLocalDateTime(date) {
    let d;
    if (date == null || date === '') {
        d = new Date();
    } else if (date instanceof Date) {
        d = date;
    } else {
        d = new Date(date);
    }

    if (Number.isNaN(d.getTime())) {
        return null;
    }

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 规范化时间值，接受多种输入格式，统一输出本地时间字符串
 * @param {*} value - 时间值
 * @returns {string|null}
 */
function normalizeDateTime(value) {
    if (value == null || value === '') {
        return null;
    }
    if (value instanceof Date || typeof value === 'number') {
        return formatLocalDateTime(value);
    }
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
        return trimmed;
    }
    return formatLocalDateTime(trimmed);
}

/**
 * 获取当前本地时间字符串（MySQL DATETIME 格式）
 * 等价于 formatLocalDateTime(new Date())
 * @returns {string} 'YYYY-MM-DD HH:mm:ss'
 */
function nowLocalDateTime() {
    return formatLocalDateTime(new Date());
}

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

// 导出时间格式化工具
exports.formatLocalDateTime = formatLocalDateTime;
exports.normalizeDateTime = normalizeDateTime;
exports.nowLocalDateTime = nowLocalDateTime;

/**
 * 【文件职责】后端通用小工具集合，放置与具体业务无关的格式化、转换或校验函数。
 * 【配置中心关联】无直接读取；若某工具需要场景配置，应由调用方显式传入，避免隐式耦合。
 */