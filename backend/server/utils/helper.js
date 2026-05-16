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

