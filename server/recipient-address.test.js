const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatRecipientLines, renderRecipientBlockHtml } = require('./recipient-address');

const MB_ESPANA_ADDRESS = 'CIF ESA79380465\nAvda. de Bruselas, 30\n28108 Alcobendas (Madrid)\nEspaña';

describe('recipient-address', () => {
  describe('formatRecipientLines', () => {
    it('ends every line but the last with a comma so joined text still separates', () => {
      assert.deepEqual(formatRecipientLines('Mercedes-Benz España, S.A.U.', MB_ESPANA_ADDRESS), [
        'Mercedes-Benz España, S.A.U.',
        'CIF ESA79380465,',
        'Avda. de Bruselas, 30,',
        '28108 Alcobendas (Madrid),',
        'España',
      ]);
    });

    it('does not double up punctuation a line already ends with', () => {
      assert.deepEqual(formatRecipientLines('Acme Inc.', 'P.O. Box 100,\nTuscaloosa, AL 35403'), [
        'Acme Inc.',
        'P.O. Box 100,',
        'Tuscaloosa, AL 35403',
      ]);
    });

    it('drops blank lines, trims whitespace and handles Windows line endings', () => {
      assert.deepEqual(formatRecipientLines('  Acme  ', '  1 Main St \r\n\r\n Springfield '), ['Acme', '1 Main St,', 'Springfield']);
    });

    it('returns just the name when there is no address', () => {
      assert.deepEqual(formatRecipientLines('Acme', null), ['Acme']);
    });
  });

  describe('renderRecipientBlockHtml', () => {
    it('labels the block and escapes customer text', () => {
      const html = renderRecipientBlockHtml('A & B <Co>', '1 Main St');
      assert.match(html, /Bill To:/);
      assert.match(html, /A &amp; B &lt;Co&gt;/);
      assert.match(html, />1 Main St </);
    });

    it('puts the name first in bold', () => {
      const html = renderRecipientBlockHtml('Acme', '1 Main St');
      assert.match(html, /font-weight: bold;[^"]*">Acme /);
      assert.ok(html.indexOf('>Acme ') < html.indexOf('>1 Main St'));
    });

    it('keeps a trailing space on every line so joined text stays separated', () => {
      const html = renderRecipientBlockHtml('Acme', '1 Main St\nSpringfield');
      assert.match(html, /white-space: pre-wrap;[^"]*">Acme <\/div>/);
      assert.match(html, /white-space: pre-wrap;">1 Main St, <\/div>/);
      assert.match(html, /white-space: pre-wrap;">Springfield <\/div>/);
    });
  });
});
