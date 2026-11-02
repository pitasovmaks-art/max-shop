function validateOrder(body) {
    if (!body || typeof body !== 'object') return 'Некорректный заказ';
    const text = (v, max, required = false) => (v == null && !required) || (typeof v === 'string' && v.trim().length >= (required ? 1 : 0) && v.length <= max);
    if (!text(body.name,100,true)) return 'Укажите имя (до 100 символов)';
    if (!text(body.phone,40,true) || !/^[78]\d{10}$/.test(body.phone.replace(/\D/g,''))) return 'Укажите корректный номер телефона';
    if (!text(body.store,200,true)) return 'Укажите магазин';
    if (!['krd','msk'].includes(body.city)) return 'Выберите город магазина';
    if (!text(body.comment,1000) || !text(body.address,500)) return 'Слишком длинный адрес или комментарий';
    if (body.delivery === 'city' && !text(body.address,500,true)) return 'Укажите адрес доставки';
    if (typeof body.total !== 'number' || !Number.isSafeInteger(body.total) || body.total < 0) return 'Некорректная сумма заказа';
    if (body.storeId != null && (!Number.isInteger(body.storeId) || body.storeId < 1)) return 'Некорректный магазин';
    if (body.requestId != null && (typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(body.requestId))) return 'Некорректный идентификатор запроса';
    return null;
}
module.exports = { validateOrder };
