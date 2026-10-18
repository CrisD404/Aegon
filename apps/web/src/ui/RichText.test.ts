import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RichText } from './RichText.tsx';

const render = (text: string) => renderToStaticMarkup(createElement(RichText, { text }));

describe('RichText', () => {
  it('formatea código, negrita y links web', () => {
    const html = render('Usá `POST /x` y **ojo**: [docs](https://example.com)');
    expect(html).toContain('<code');
    expect(html).toContain('<strong>ojo</strong>');
    expect(html).toContain('href="https://example.com"');
  });

  it('no genera links que no sean web o correo, y escapa el HTML', () => {
    const html = render('[click](javascript:alert(1)) <img src=x onerror=alert(1)>');
    expect(html).not.toContain('href="javascript');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
