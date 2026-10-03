const DAY_MS = 86_400_000;

export const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function dateFromISO(value) {
  return new Date(`${value}T12:00:00.000Z`);
}

export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(value, amount) {
  const date = typeof value === 'string' ? dateFromISO(value) : new Date(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return isoDate(date);
}

// A semana operacional vai de segunda a sábado. No domingo, a referência
// continua sendo a semana que acabou no sábado anterior.
export function operationalWeek(dateValue) {
  const date = dateFromISO(dateValue);
  const day = date.getUTCDay();
  const distanceFromMonday = day === 0 ? 6 : day - 1;
  const start = new Date(date.getTime() - distanceFromMonday * DAY_MS);
  return { start: isoDate(start), end: addDays(start, 5) };
}

export function calendarMonthRange(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const start = `${year}-${String(monthNumber).padStart(2, '0')}-01`;
  const end = isoDate(new Date(Date.UTC(year, monthNumber, 0, 12)));
  return { start, end };
}

export function weekStartsForMonth(month) {
  const { start, end } = calendarMonthRange(month);
  const first = operationalWeek(start).start;
  const starts = [];
  for (let cursor = first; cursor <= end; cursor = addDays(cursor, 7)) {
    const weekEnd = addDays(cursor, 5);
    if (weekEnd >= start && weekEnd <= end) starts.push(cursor);
  }
  return starts;
}

function locationKind(delivery) {
  const name = String(delivery.location_name || delivery.name || delivery.location_id || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (delivery.category === 'natal') return 'natal';
  if (delivery.category === 'zona_norte') return 'zona_norte';
  if (name.includes('macaiba')) return 'macaiba';
  if (name.includes('parnamirim')) return 'parnamirim';
  if (name.includes('sao jose')) return 'sao_jose';
  return 'outro';
}

export function calculateWeek(deliveries, options = {}) {
  const baseAmount = money(options.baseAmount ?? 663.33);
  const ordered = [...deliveries].sort((a, b) =>
    String(a.delivery_date).localeCompare(String(b.delivery_date)) ||
    String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
    String(a.id).localeCompare(String(b.id))
  );
  const periods = new Map();
  function periodKey(delivery) {
    return delivery.delivery_date;
  }
  for (const delivery of ordered) {
    const key = periodKey(delivery);
    if (!periods.has(key)) periods.set(key, { natal: 0, north: 0, natalUsed: 0, fallbackUsed: 0 });
    const period = periods.get(key);
    const kind = locationKind(delivery);
    if (kind === 'natal') period.natal += 1;
    if (kind === 'zona_norte') period.north += 1;
  }
  let extraAmount = 0;
  let extraCount = 0;
  let weekdayUsed = 0;
  let weekendNatalUsed = 0;
  const items = ordered.map((delivery) => {
    const day = dateFromISO(delivery.delivery_date).getUTCDay();
    const isWeekend = day === 0 || day === 6;
    const kind = locationKind(delivery);
    const period = periods.get(periodKey(delivery));
    const natalLimit = isWeekend ? Number(options.weekendNatalIncluded ?? 2) : Number(options.weekdayIncluded ?? 15);
    const regionalMinimum = isWeekend ? Number(options.weekendNatalIncluded ?? 2) : Number(options.regionalMinimum ?? 7);
    const fallback = period.north > 0 ? 'zona_norte' : 'macaiba';
    const fallbackIncluded = Math.max(0, regionalMinimum - period.natal);
    let rate = money(delivery.value_override ??
      (isWeekend ? delivery.weekend_value : delivery.weekday_value) ?? 0);
    // Natal excedente segue a regra de R$ 10. Demais locais usam a taxa cadastrada.
    if (kind === 'natal') rate = 10;
    let charge = false;
    let reason = '';
    if (kind === 'natal') {
      period.natalUsed += 1;
      if (isWeekend) weekendNatalUsed += 1;
      else weekdayUsed += 1;
      charge = period.natalUsed > natalLimit;
      reason = charge
        ? `Natal: acima de ${natalLimit} entregas, R$ 10,00 por excedente`
        : `Natal: incluída nas primeiras ${natalLimit} entregas`;
    } else if (kind === fallback) {
      period.fallbackUsed += 1;
      charge = period.fallbackUsed > fallbackIncluded;
      if (!charge && !isWeekend) weekdayUsed += 1;
      reason = charge
        ? `Extra: limite de ${regionalMinimum} entregas de referência preenchido`
        : `${kind === 'zona_norte' ? 'Zona Norte' : 'Macaíba'} conta como Natal para completar ${regionalMinimum}`;
    } else {
      charge = true;
      reason = 'Local cobrado à parte, sem consumir o limite de Natal';
    }
    // Inclusão manual do administrador continua disponível.
    // Marcar Natal como extra não antecipa o limite obrigatório.
    if (delivery.billing_mode === 'included') {
      charge = false;
      reason = 'Marcada manualmente como incluída';
    } else if (delivery.billing_mode === 'extra' && kind !== 'natal') {
      charge = true;
      reason = 'Marcada manualmente como extra';
    }
    const extraValue = charge ? rate : 0;
    const isExtra = extraValue > 0;
    if (isExtra) {
      extraCount += 1;
      extraAmount = money(extraAmount + extraValue);
    }
    return {
      ...delivery,
      is_extra: isExtra,
      extra_value: extraValue,
      calculated_rate: rate,
      rule_reason: reason
    };
  });
  return {
    delivery_count: items.length,
    included_count: items.length - extraCount,
    extra_count: extraCount,
    base_amount: baseAmount,
    extra_amount: money(extraAmount),
    total_amount: money(baseAmount + extraAmount),
    weekday_used: weekdayUsed,
    regional_daily_minimum: Number(options.regionalMinimum ?? 7),
    weekday_included: Number(options.weekdayIncluded ?? 15),
    weekend_natal_used: weekendNatalUsed,
    weekend_natal_included: Number(options.weekendNatalIncluded ?? 2),
    items
  };
}

export function groupByDay(calculation) {
  const groups = new Map();
  for (const item of calculation.items) {
    const current = groups.get(item.delivery_date) || {
      date: item.delivery_date,
      delivery_count: 0,
      extra_count: 0,
      extra_amount: 0
    };
    current.delivery_count += 1;
    if (item.is_extra) {
      current.extra_count += 1;
      current.extra_amount = money(current.extra_amount + item.extra_value);
    }
    groups.set(item.delivery_date, current);
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}
