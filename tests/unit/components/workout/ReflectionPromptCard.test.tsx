import React from 'react';
import { render } from '@testing-library/react-native';
import ReflectionPromptCard from '@/components/workout/ReflectionPromptCard';
import {
  REFLECTION_PROMPTS,
  type ReflectionPrompt,
} from '@/lib/services/between-sets-coach';

describe('ReflectionPromptCard', () => {
  const basePrompt: ReflectionPrompt = REFLECTION_PROMPTS.find((p) => p.category === 'form')!;

  it('renders the prompt text', () => {
    const { getByTestId } = render(<ReflectionPromptCard prompt={basePrompt} />);
    expect(getByTestId('reflection-prompt-text').props.children).toBe(basePrompt.text);
  });

  it('renders a form category tag for a form prompt', () => {
    const { getByText } = render(<ReflectionPromptCard prompt={basePrompt} />);
    expect(getByText('Form')).toBeTruthy();
  });

  it('renders a focus tag for mindset category', () => {
    const mindset = REFLECTION_PROMPTS.find((p) => p.category === 'mindset')!;
    const { getByText } = render(<ReflectionPromptCard prompt={mindset} />);
    expect(getByText('Focus')).toBeTruthy();
  });

  it('renders a breath tag for breathing category', () => {
    const breath = REFLECTION_PROMPTS.find((p) => p.category === 'breathing')!;
    const { getByText } = render(<ReflectionPromptCard prompt={breath} />);
    expect(getByText('Breath')).toBeTruthy();
  });

  it('renders a progress tag for progress category', () => {
    const progress = REFLECTION_PROMPTS.find((p) => p.category === 'progress')!;
    const { getByText } = render(<ReflectionPromptCard prompt={progress} />);
    expect(getByText('Progress')).toBeTruthy();
  });
});
