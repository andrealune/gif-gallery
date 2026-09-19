import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { JsonLd } from './JsonLd';

describe('JsonLd', () => {
  it('renders a script tag containing the serialized, parseable JSON-LD', () => {
    const { container } = render(<JsonLd data={{ '@context': 'https://schema.org', '@type': 'Thing', name: 'x' }} />);

    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    expect(JSON.parse(script?.textContent ?? '')).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Thing',
      name: 'x',
    });
  });

  it('escapes unsafe content so it cannot break out of the script tag', () => {
    const { container } = render(<JsonLd data={{ name: '</script><script>alert(1)</script>' }} />);
    const script = container.querySelector('script[type="application/ld+json"]');

    expect(script?.innerHTML).not.toContain('</script><script>');
    expect(JSON.parse(script?.textContent ?? '').name).toBe('</script><script>alert(1)</script>');
  });
});
