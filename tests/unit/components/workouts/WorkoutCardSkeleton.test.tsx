import React from 'react';
import { render } from '@testing-library/react-native';

import {
  WorkoutCardSkeleton,
  WorkoutCardSkeletonList,
} from '@/components/workouts/WorkoutCardSkeleton';

describe('WorkoutCardSkeleton', () => {
  it('renders with the default testID', () => {
    const { getByTestId } = render(<WorkoutCardSkeleton />);
    expect(getByTestId('workout-card-skeleton')).toBeTruthy();
  });

  it('honours a custom testID', () => {
    const { getByTestId } = render(
      <WorkoutCardSkeleton testID="skeleton-42" />,
    );
    expect(getByTestId('skeleton-42')).toBeTruthy();
  });

  it('marks the host with a loading label for screen readers', () => {
    const { getByTestId } = render(<WorkoutCardSkeleton />);
    const node = getByTestId('workout-card-skeleton');
    // The root keeps a concise "Loading workout" label so VoiceOver users
    // hear a single status announcement instead of descendants of the
    // shimmer tree.
    expect(node.props.accessibilityLabel).toBe('Loading workout');
  });
});

describe('WorkoutCardSkeletonList', () => {
  it('renders the default count of 3 skeletons', () => {
    const { getByTestId, queryByTestId } = render(<WorkoutCardSkeletonList />);
    expect(getByTestId('workout-card-skeleton-list')).toBeTruthy();
    expect(getByTestId('workout-card-skeleton-0')).toBeTruthy();
    expect(getByTestId('workout-card-skeleton-1')).toBeTruthy();
    expect(getByTestId('workout-card-skeleton-2')).toBeTruthy();
    expect(queryByTestId('workout-card-skeleton-3')).toBeNull();
  });

  it('honours an explicit count prop', () => {
    const { getByTestId, queryByTestId } = render(
      <WorkoutCardSkeletonList count={5} />,
    );
    for (let i = 0; i < 5; i += 1) {
      expect(getByTestId(`workout-card-skeleton-${i}`)).toBeTruthy();
    }
    expect(queryByTestId('workout-card-skeleton-5')).toBeNull();
  });

  it('clamps count to at least 1 when caller passes 0 or negative', () => {
    const { getByTestId, queryByTestId } = render(
      <WorkoutCardSkeletonList count={0} />,
    );
    expect(getByTestId('workout-card-skeleton-0')).toBeTruthy();
    expect(queryByTestId('workout-card-skeleton-1')).toBeNull();
  });
});
