// Lokasi: src/lib/utils/format.test.ts
// Unit Test untuk utilitas pemformatan deterministik FIM-Property CRM

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatRupiah,
  formatDateID,
  formatDateTimeID,
  getInitials,
  getFirstName,
} from './format';

describe('format.ts utilities', () => {
  it('formats Rupiah properly with Rp prefix and dot thousands separator', () => {
    assert.equal(formatRupiah(850000000), 'Rp 850.000.000');
    assert.equal(formatRupiah('12500000'), 'Rp 12.500.000');
    assert.equal(formatRupiah(0), 'Rp 0');
    assert.equal(formatRupiah(null), 'Rp 0');
  });

  it('formats Indonesian dates deterministically', () => {
    assert.equal(formatDateID('2026-03-16'), '16 Mar 2026');
    assert.equal(formatDateTimeID('2026-03-16T07:30:00.000Z'), '16 Mar 2026, 14:30 WIB');
    assert.equal(formatDateID(null), '-');
  });

  it('extracts staff initials and first name accurately', () => {
    assert.equal(getInitials('Muhammad Ichsan Fachrulrozi'), 'MI');
    assert.equal(getInitials('Fariz Aditya Ardhana'), 'FA');
    assert.equal(getFirstName('Fariz Aditya Ardhana'), 'Fariz');
    assert.equal(getFirstName('Muzayin Alif'), 'Muzayin');
  });
});
