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

export function calculateWeek(deliveries, options = {}) {
  const weekdayIncluded = Math.max(0, Number(options.weekdayIncluded ?? 6));
  const weekendNatalIncluded = Math.max(0, Number(options.weekendNatalIncluded ?? 2));
  const baseAmount = money(options.baseAmount ?? 663.33);

  const ordered = [...deliveries].sort((a, b) =>
    String(a.delivery_date).localeCompare(String(b.delivery_date)) ||
    String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
    String(a.id).localeCompare(String(b.id))
  );

  let weekdayUsed = 0;
  let weekendNatalUsed = 0;
  let extraAmount = 0;
  let extraCount = 0;

  const items = ordered.map((delivery) => {
    const day = dateFromISO(delivery.delivery_date).getUTCDay();
    const isWeekend = day === 0 || day === 6;
    const rate = money(
      delivery.value_override ??
      (isWeekend ? delivery.weekend_value : delivery.weekday_value) ??
      0
    );

    let isExtra = false;
    let reason = '';

    if (delivery.billing_mode === 'extra') {
      isExtra = true;
      reason = 'Marcada manualmente como extra';
    } else if (delivery.billing_mode === 'included') {
      if (isWeekend && delivery.category === 'natal') weekendNatalUsed += 1;
      if (!isWeekend) weekdayUsed += 1;
      reason = 'Marcada manualmente como incluída';
    } else if (!isWeekend) {
      weekdayUsed += 1;
      isExtra = weekdayUsed > weekdayIncluded;
      reason = isExtra
        ? `Acima das ${weekdayIncluded} entregas incluídas de segunda a sexta`
        : `Incluída no limite de ${weekdayIncluded} entregas de segunda a sexta`;
    } else if (delivery.category === 'natal') {
      weekendNatalUsed += 1;
      isExtra = weekendNatalUsed > weekendNatalIncluded;
      reason = isExtra
        ? `Acima das ${weekendNatalIncluded} entregas de Natal incluídas no fim de semana`
        : `Incluída no limite de ${weekendNatalIncluded} entregas de Natal no fim de semana`;
    } else {
      isExtra = true;
      reason = 'Fora de Natal no fim de semana: cobrança integral';
    }

    const extraValue = isExtra ? rate : 0;
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
    weekday_included: weekdayIncluded,
    weekend_natal_used: weekendNatalUsed,
    weekend_natal_included: weekendNatalIncluded,
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
