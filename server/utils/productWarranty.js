const { createHash } = require('node:crypto');

function parseWarranty(value) {
    if (value == null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректные условия гарантии.');
    const integer = (n, max) => {
        if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new Error('Проверьте срок гарантии и доплаты в рублях.');
        return n;
    };
    const plain = (text, max) => {
        if (typeof text !== 'string' || text.length > max) throw new Error('Проверьте длину описания гарантии или сервиса.');
        return text.trim();
    };
    const baseDays = integer(value.baseDays, 3650);
    const baseTerms = plain(value.baseTerms, 3000);
    let service = null;
    if (value.service != null) {
        const { start } = value.service;
        const title = plain(value.service.title, 100);
        const terms = plain(value.service.terms, 6000);
        const months = integer(value.service.months, 120);
        const priceMsk = integer(value.service.priceMsk, 100000000);
        const priceKrd = integer(value.service.priceKrd, 100000000);
        if (!title || !terms || !months || (!priceMsk && !priceKrd) ||
            !['handover', 'after_base'].includes(start) || (start === 'after_base' && !baseDays)) {
            throw new Error('Заполните название, срок, начало действия, покрытие и доплату хотя бы для одного города.');
        }
        service = { title, terms, months, start, priceMsk, priceKrd };
    }
    return baseDays || baseTerms || service ? { baseDays, baseTerms, service } : null;
}

function publicWarranty(value) {
    const warranty = parseWarranty(value);
    if (!warranty?.service) return warranty;
    const revision = createHash('sha256').update(JSON.stringify(warranty)).digest('hex');
    return { ...warranty, service: { ...warranty.service, revision } };
}

module.exports = { parseWarranty, publicWarranty };
