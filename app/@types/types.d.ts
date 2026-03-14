import { LinkProps as OriginalLinkProps } from 'expo-router/build/link/Link';

declare module 'expo-router' {
  // Extend the Link component props to include our routes
  export interface LinkProps extends Omit<OriginalLinkProps, 'href'> {
    href: 
      | '/sign-in'
      | '/sign-up'
      | '/forgot-password'
      | '/reset-password'
      | `/${string}`;
  }

  // Extend the router to include our routes
  export function useRouter(): {
    push: (path: 
      | '/sign-in'
      | '/sign-up'
      | '/forgot-password'
      | '/reset-password'
      | `/${string}`) => void;
    back: () => void;
    replace: (path: string) => void;
    setParams: (params: Record<string, string>) => void;
  };
}

// Add a default export to satisfy Expo Router
export default function DefaultComponent() {
  return null;
}
