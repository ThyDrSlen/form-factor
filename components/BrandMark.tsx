import { Image, type StyleProp, type ImageStyle } from 'react-native';

export function BrandMark({ size = 48, style }: { size?: number; style?: StyleProp<ImageStyle> }) {
  return (
    <Image
      source={require('../assets/images/ff-icon-v2.png')}
      style={[{ width: size, height: size, borderRadius: size * 0.22 }, style]}
      resizeMode="contain"
      accessible={false}
    />
  );
}
