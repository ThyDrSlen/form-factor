import { useCallback } from 'react';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useRouter } from 'expo-router';

/**
 * useSafeBack
 *
 * Returns a function that attempts to go back in the current navigation stack.
 * If there is no back history, it will replace the current route with the provided fallbackPath.
 *
 * Example:
 * const safeBack = useSafeBack('/workouts');
 * <Button onPress={safeBack} />
 */
export function useSafeBack(
  fallback: string | string[],
  options?: { alwaysReplace?: boolean }
) {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const router = useRouter();

  const safeBack = useCallback(() => {
    const canGo = typeof navigation?.canGoBack === 'function' && navigation.canGoBack();
    console.log('[useSafeBack] invoked', { canGoBack: canGo, fallback });
    if (!options?.alwaysReplace && canGo) {
      navigation.goBack();
      return;
    }

    const paths = Array.isArray(fallback) ? fallback : [fallback];
    // Prefer first path; if it contains group, expo-router will still handle it correctly
    const target = paths[0];
    console.log('[useSafeBack] replacing to', target);
    router.replace(target);
  }, [navigation, router, fallback, options?.alwaysReplace]);

  return safeBack;
}
