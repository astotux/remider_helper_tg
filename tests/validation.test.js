import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  parseDateInput,
  parseTimeInput,
  validateButtonTitle,
  validateTelegramHtml,
  validateTitle,
  validateUrl
} from '../src/utils/validation.utils.js';

describe('validation.utils', () => {
  it('validates reminder titles', () => {
    assert.deepEqual(validateTitle('  Утренний созвон  '), {
      valid: true,
      value: 'Утренний созвон'
    });
    assert.equal(validateTitle('   ').valid, false);
    assert.equal(validateTitle('a'.repeat(201)).valid, false);
  });

  it('validates allowed URLs and rejects unsafe schemes', () => {
    assert.equal(validateUrl('https://example.com/guide?a=1').valid, true);
    assert.equal(validateUrl('http://localhost:3000').valid, true);
    assert.equal(validateUrl('javascript:alert(1)').valid, false);
    assert.equal(validateUrl('ftp://example.com/file').valid, false);
    assert.equal(validateUrl('not a url').valid, false);
  });

  it('validates button title length', () => {
    assert.equal(validateButtonTitle('Открыть инструкцию').valid, true);
    assert.equal(validateButtonTitle('').valid, false);
    assert.equal(validateButtonTitle('x'.repeat(65)).valid, false);
  });

  it('validates Telegram HTML tags and rejects broken markup', () => {
    assert.equal(
      validateTelegramHtml('<b>Важно:</b> <i>проверить</i> <a href="https://example.com">ссылку</a>').valid,
      true
    );
    assert.equal(validateTelegramHtml('<blockquote expandable>Скрытый список</blockquote>').valid, true);
    assert.equal(validateTelegramHtml('<b>Незакрытый тег').valid, false);
    assert.equal(validateTelegramHtml('<b><i>Перепутан порядок</b></i>').valid, false);
    assert.equal(validateTelegramHtml('<script>alert(1)</script>').valid, false);
    assert.equal(validateTelegramHtml('<a href="javascript:alert(1)">клик</a>').valid, false);
    assert.equal(validateTelegramHtml('5 < 10').valid, false);
    assert.equal(validateTelegramHtml('5 &lt; 10').valid, true);
  });

  it('parses time and calendar dates accurately', () => {
    assert.deepEqual(parseTimeInput('9:05'), { valid: true, value: '09:05' });
    assert.deepEqual(parseTimeInput('23:59'), { valid: true, value: '23:59' });
    assert.equal(parseTimeInput('24:00').valid, false);
    assert.equal(parseTimeInput('12:60').valid, false);

    assert.deepEqual(parseDateInput('25.12.2026'), { valid: true, value: '2026-12-25' });
    assert.deepEqual(parseDateInput('2026-12-25'), { valid: true, value: '2026-12-25' });
    assert.equal(parseDateInput('31.02.2026').valid, false);
    assert.equal(parseDateInput('25/12/2026').valid, false);
  });

  it('escapes HTML special characters', () => {
    assert.equal(escapeHtml('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
  });
});
