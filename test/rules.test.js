import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateWeek, operationalWeek, weekStartsForMonth } from '../src/rules.js';

const item = (id, date, category = 'natal', value = 20) => ({
  id,
  delivery_date: date,
  created_at: `2026-10-02T10:00:${String(id).padStart(2, '0')}Z`,
  category,
  weekday_value: value,
  weekend_value: value,
  billing_mode: 'auto'
});

test('semana operacional vai de segunda a sábado e domingo aponta para a semana encerrada', () => {
  assert.deepEqual(operationalWeek('2026-10-02'), { start: '2026-09-28', end: '2026-10-03' });
  assert.deepEqual(operationalWeek('2026-10-04'), { start: '2026-09-28', end: '2026-10-03' });
});

test('a sétima entrega de segunda a sexta vira extra', () => {
  const deliveries = Array.from({ length: 7 }, (_, index) => item(index + 1, '2026-09-28'));
  const result = calculateWeek(deliveries, { baseAmount: 663.33 });
  assert.equal(result.delivery_count, 7);
  assert.equal(result.extra_count, 1);
  assert.equal(result.extra_amount, 20);
  assert.equal(result.total_amount, 683.33);
});

test('no sábado as duas primeiras de Natal são incluídas e fora de Natal é extra', () => {
  const deliveries = [
    item(1, '2026-10-03'),
    item(2, '2026-10-03'),
    item(3, '2026-10-03'),
    item(4, '2026-10-03', 'zona_norte', 20),
    item(5, '2026-10-03', 'fora_natal', 30)
  ];
  const result = calculateWeek(deliveries);
  assert.equal(result.included_count, 2);
  assert.equal(result.extra_count, 3);
  assert.equal(result.extra_amount, 70);
});

test('mês usa semanas que terminam no próprio mês', () => {
  assert.deepEqual(weekStartsForMonth('2026-10'), ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
});
