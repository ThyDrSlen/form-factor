import React from 'react';
import { render } from '@testing-library/react-native';
import { AccessibleText } from '@/lib/a11y/AccessibleText';
import { MAX_FONT_SCALE } from '@/lib/a11y/typography';

describe('AccessibleText', () => {
  it('defaults allowFontScaling to true and caps maxFontSizeMultiplier', () => {
    const { getByText } = render(<AccessibleText>hello</AccessibleText>);
    const node = getByText('hello');
    expect(node.props.allowFontScaling).toBe(true);
    expect(node.props.maxFontSizeMultiplier).toBe(MAX_FONT_SCALE);
  });

  it('allows callers to override the defaults', () => {
    const { getByText } = render(
      <AccessibleText allowFontScaling={false} maxFontSizeMultiplier={2}>
        override
      </AccessibleText>,
    );
    const node = getByText('override');
    expect(node.props.allowFontScaling).toBe(false);
    expect(node.props.maxFontSizeMultiplier).toBe(2);
  });
});
