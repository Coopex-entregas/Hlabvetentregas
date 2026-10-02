const DAY_MS = 86_400_000;

export const money = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function dateFromISO(value) {
  return new Date(`${value}T12:00:00.000Z`);
}

export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(value, amount) {
  const date =
    typeof value === 'string'
      ? dateFromISO(value)
      : new Date(value);

  date.setUTCDate(date.getUTCDate() + amount);
  return isoDate(date);
}

// Semana operacional: segunda a sábado.
// Domingo aponta para a semana encerrada.
export function operationalWeek(dateValue) {
  const date = dateFromISO(dateValue);
  const day = date.getUTCDay();
  const distanceFromMonday = day === 0 ? 6 : day - 1;
  const start = new Date(
    date.getTime() - distanceFromMonday * DAY_MS
  );

  return {
    start: isoDate(start),
    end: addDays(start, 5)
  };
}

export function calendarMonthRange(month) {
  const [year, monthNumber] = month.split('-').map(Number);

  return {
    start: `${year}-${String(monthNumber).padStart(2, '0')}-01`,
    end: isoDate(
      new Date(Date.UTC(year, monthNumber, 0, 12))
    )
  };
}

export function weekStartsForMonth(month) {
  const { start, end } = calendarMonthRange(month);
  const first = operationalWeek(start).start;
  const starts = [];

  for (
    let cursor = first;
    cursor <= end;
    cursor = addDays(cursor, 7)
  ) {
    const weekEnd = addDays(cursor, 5);

    if (weekEnd >= start && weekEnd <= end) {
      starts.push(cursor);
    }
  }

  return starts;
}

function locationKind(delivery) {
  const name = String(
    delivery.location_name ||
    delivery.name ||
    delivery.location_id ||
    ''
  )
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (delivery.category === 'natal') {
    return 'natal';
  }

  if (delivery.category === 'zona_norte') {
    return 'zona_norte';
  }

  if (name.includes('macaiba')) {
    return 'macaiba';
  }

  if (name.includes('parnamirim')) {
    return 'parnamirim';
  }

  if (name.includes('sao jose')) {
    return 'sao_jose';
  }

  return 'outro';
}

export function calculateWeek(deliveries, options = {}) {
  const baseAmount = money(options.baseAmount ?? 663.33);

  const ordered = [...deliveries].sort(
    (a, b) =>
      String(a.delivery_date).localeCompare(
        String(b.delivery_date)
      ) ||
      String(a.created_at || '').localeCompare(
        String(b.created_at || '')
      ) ||
      String(a.id).localeCompare(String(b.id))
  );

  const periods = new Map();

  function periodKey(delivery) {
    const day = dateFromISO(
      delivery.delivery_date
    ).getUTCDay();

    // Sábado e domingo são calculados separadamente.
    if (day === 0 || day === 6) {
      return delivery.delivery_date;
    }

    // Segunda a sexta compartilham o limite da semana.
    return operationalWeek(delivery.delivery_date).start;
  }

  // Primeiro conta os locais do período inteiro.
  // A ordem de cadastro não altera a regra.
  for (const delivery of ordered) {
    const key = periodKey(delivery);

    if (!periods.has(key)) {
      periods.set(key, {
        natal: 0,
        north: 0,
        natalUsed: 0,
        fallbackUsed: 0
      });
    }

    const period = periods.get(key);
    const kind = locationKind(delivery);

    if (kind === 'natal') {
      period.natal += 1;
    }

    if (kind === 'zona_norte') {
      period.north += 1;
    }
  }

  let extraAmount = 0;
  let extraCount = 0;
  let weekdayUsed = 0;
  let weekendNatalUsed = 0;

  const items = ordered.map((delivery) => {
    const day = dateFromISO(
      delivery.delivery_date
    ).getUTCDay();

    const isWeekend = day === 0 || day === 6;
    const kind = locationKind(delivery);
    const period = periods.get(periodKey(delivery));

    // Natal: primeiras 15 incluídas de segunda a sexta.
    // Fim de semana: primeiras 2 incluídas.
    const natalLimit = isWeekend ? 2 : 15;

    // Zona Norte começa a ser cobrada após completar
    // 7 entregas de referência na semana, ou 2 no sábado.
    const regionalMinimum = isWeekend ? 2 : 7;

    // Havendo Zona Norte, ela completa o limite.
    // Sem Zona Norte, Macaíba completa o limite.
    const fallback =
      period.north > 0 ? 'zona_norte' : 'macaiba';

    const fallbackIncluded = Math.max(
      0,
      regionalMinimum - period.natal
    );

    let rate = money(
      delivery.value_override ??
      (
        isWeekend
          ? delivery.weekend_value
          : delivery.weekday_value
      ) ??
      0
    );

    // Corrige também os cadastros antigos que tinham
    // Natal ou Parnamirim com valor de R$ 20.
    if (kind === 'natal') {
      rate = 10;
    }

    if (kind === 'parnamirim') {
      rate = 15;
    }

    if (kind === 'sao_jose') {
      rate = 50;
    }

    // Zona Norte, Macaíba e demais locais usam
    // o valor cadastrado para o bairro.
    let charge = false;
    let reason = '';

    if (kind === 'natal') {
      period.natalUsed += 1;

      if (isWeekend) {
        weekendNatalUsed += 1;
      } else {
        weekdayUsed += 1;
      }

      charge = period.natalUsed > natalLimit;

      reason = charge
        ? `Natal: acima de ${natalLimit} entregas, R$ 10,00 por excedente`
        : `Natal: incluída nas primeiras ${natalLimit} entregas`;
    } else if (kind === fallback) {
      period.fallbackUsed += 1;

      charge =
        period.fallbackUsed > fallbackIncluded;

      if (!charge && !isWeekend) {
        weekdayUsed += 1;
      }

      const label =
        kind === 'zona_norte'
          ? 'Zona Norte'
          : 'Macaíba';

      reason = charge
        ? `Extra: limite de ${regionalMinimum} entregas de referência preenchido`
        : `${label} conta como Natal para completar ${regionalMinimum}`;
    } else {
      // São José, Parnamirim, Cajupiranga e demais
      // locais são cobrados à parte.
      // Macaíba também é cobrada à parte quando
      // a Zona Norte é usada para completar o limite.
      charge = true;
      reason =
        'Local cobrado à parte, sem consumir o limite de Natal';
    }

    // Permite inclusão manual pelo administrador.
    if (delivery.billing_mode === 'included') {
      charge = false;
      reason = 'Marcada manualmente como incluída';
    } else if (
      delivery.billing_mode === 'extra' &&
      kind !== 'natal'
    ) {
      charge = true;
      reason = 'Marcada manualmente como extra';
    }

    // Natal não vira extra antes do limite,
    // mesmo se marcada como extra no formulário.
    const extraValue = charge ? rate : 0;

    // Somente entregas com cobrança positiva
    // entram na quantidade de extras.
    const isExtra = extraValue > 0;

    if (isExtra) {
      extraCount += 1;
      extraAmount = money(
        extraAmount + extraValue
      );
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
    weekday_included: 15,
    weekend_natal_used: weekendNatalUsed,
    weekend_natal_included: 2,
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
      current.extra_amount = money(
        current.extra_amount + item.extra_value
      );
    }

    groups.set(item.delivery_date, current);
  }

  return [...groups.values()].sort(
    (a, b) => a.date.localeCompare(b.date)
  );
}
