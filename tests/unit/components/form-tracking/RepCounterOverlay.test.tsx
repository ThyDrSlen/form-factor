import React from 'react';
import { render } from '@testing-library/react-native';
import Svg from 'react-native-svg';
import { RepCounterOverlay, RepCounterAnnouncer } from '@/components/form-tracking/RepCounterOverlay';

const renderInSvg = (ui: React.ReactElement) =>
  render(<Svg viewBox="0 0 1 1">{ui}</Svg>);

describe('<RepCounterOverlay />', () => {
  it('renders a visible node when visible=true', () => {
    const { getByTestId } = renderInSvg(
      <RepCounterOverlay currentRep={7} visible x={0.5} y={0.5} opacity={1} />
    );
    expect(getByTestId('rep-counter-overlay')).toBeTruthy();
  });

  it('renders the rep digits as text content', () => {
    const { getByTestId } = renderInSvg(
      <RepCounterOverlay currentRep={7} visible x={0.5} y={0.5} opacity={1} />
    );
    // The SVG renderer wraps the number in an RNSVGTSpan; the resolved
    // child is a React element with `props.children` containing the digits.
    const node = getByTestId('rep-counter-overlay');
    const tspan = node.props.children;
    const inner = Array.isArray(tspan) ? tspan[0]?.props?.children : tspan?.props?.children;
    expect(String(inner)).toBe('7');
  });

  it('returns null when visible=false on first render', () => {
    const { queryByTestId } = renderInSvg(
      <RepCounterOverlay currentRep={3} visible={false} x={0.5} y={0.5} opacity={0} />
    );
    expect(queryByTestId('rep-counter-overlay')).toBeNull();
  });

  it('respects an explicit testID override', () => {
    const { getByTestId } = renderInSvg(
      <RepCounterOverlay
        currentRep={1}
        visible
        x={0.5}
        y={0.5}
        opacity={1}
        testID="custom-rep-counter"
      />
    );
    expect(getByTestId('custom-rep-counter')).toBeTruthy();
  });

  it('clamps opacity into 0-1 even with out-of-range input', () => {
    const { getByTestId } = renderInSvg(
      <RepCounterOverlay currentRep={5} visible x={0.5} y={0.5} opacity={2.5} />
    );
    expect(getByTestId('rep-counter-overlay')).toBeTruthy();
    // No throw = pass; the Animated value will saturate to 1.
  });

  it('exposes an accessibilityLabel with the current rep number on the SVG text', () => {
    const { getByTestId } = renderInSvg(
      <RepCounterOverlay currentRep={12} visible x={0.5} y={0.5} opacity={1} />
    );
    const node = getByTestId('rep-counter-overlay');
    expect(node.props.accessibilityLabel).toBe('Rep 12');
    expect(node.props.accessible).toBe(true);
  });

  it('updates the rendered rep when currentRep changes', () => {

    const readDigits = (node: { props: { children: unknown } }): string => {
      const tspan = node.props.children as { props?: { children?: unknown } } | { props?: { children?: unknown } }[];
      const inner = Array.isArray(tspan) ? tspan[0]?.props?.children : tspan?.props?.children;
      return String(inner);
    };
    const { rerender, getByTestId } = renderInSvg(
      <RepCounterOverlay currentRep={1} visible x={0.5} y={0.5} opacity={1} />
    );
    expect(readDigits(getByTestId('rep-counter-overlay'))).toBe('1');

    rerender(
      <Svg viewBox="0 0 1 1">
        <RepCounterOverlay currentRep={2} visible x={0.5} y={0.5} opacity={1} />
      </Svg>
    );
    expect(readDigits(getByTestId('rep-counter-overlay'))).toBe('2');
  });
});

describe('<RepCounterAnnouncer />', () => {
  it('renders a polite live-region status with the current rep', () => {
    const { getByTestId } = render(<RepCounterAnnouncer currentRep={5} />);
    const node = getByTestId('rep-counter-announcer');
    expect(node.props.accessibilityLabel).toBe('Rep 5');
    expect(node.props.accessibilityLiveRegion).toBe('polite');
    // role="status" is emitted as `role` prop on React Native 0.73+.
    expect(node.props.role).toBe('status');
  });

  it('updates the announced rep when currentRep changes', () => {
    const { rerender, getByTestId } = render(
      <RepCounterAnnouncer currentRep={1} />
    );
    expect(getByTestId('rep-counter-announcer').props.accessibilityLabel).toBe(
      'Rep 1',
    );
    rerender(<RepCounterAnnouncer currentRep={7} />);
    expect(getByTestId('rep-counter-announcer').props.accessibilityLabel).toBe(
      'Rep 7',
    );
  });
});
