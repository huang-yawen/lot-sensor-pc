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
