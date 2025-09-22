import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

interface LogoProps {
  size?: number;
  color?: string;
}

export default function Logo({ size = 40, color }: LogoProps) {
  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox="0 0 1024 1024">
        <Defs>
          <LinearGradient id="blueGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#1E90FF" />
            <Stop offset="100%" stopColor="#0066CC" />
          </LinearGradient>
        </Defs>
        
        {/* First F */}
        <Path
          d="M100 200h300v80H200v80h200v80H200v160H100V200z"
          fill={color || "url(#blueGradient)"}
        />
        
        {/* Second F */}
        <Path
          d="M100 200h300v80H200v80h200v80H200v160H100V200z"
          transform="translate(200, 0)"
          fill={color || "url(#blueGradient)"}
        />
        
        {/* Bicep/Muscle Shape */}
        <Path
          d="M550 180c80 0 150 40 200 100 50 60 80 140 80 240 0 100-30 180-80 240-50 60-120 100-200 100-40 0-80-15-110-40-30-25-50-60-60-100-10-40-5-85 15-120 20-35 55-60 95-70 40-10 85-5 120 15 35 20 60 55 70 95 10 40 5 85-15 120-20 35-55 60-95 70-25 6-50 5-70-5-20-10-35-25-45-45-10-20-15-45-15-70 0-35 10-65 30-85 20-20 50-30 80-30 20 0 38 6 52 18 14 12 24 28 28 46 4 18 2 38-6 54-8 16-22 28-38 34-16 6-34 6-50 0-10-4-18-10-24-18-6-8-10-18-12-28-2-10-2-20 0-30 2-6 6-11 12-14 6-3 13-4 20-3 4 1 7 3 9 6 2 3 3 7 2 11-1 4-4 7-8 8-4 1-8 0-11-2z"
          fill="#4A5568"
          stroke="#2D3748"
          strokeWidth="6"
        />
        
        {/* Muscle highlight */}
        <Path
          d="M600 250c30 0 55 15 70 40 15 25 20 55 15 80-5 25-20 45-40 55-20 10-45 10-65 0-15-8-25-20-30-35-5-15-5-32 0-47 5-15 15-28 28-36 13-8 28-12 44-12z"
          fill="#FFFFFF"
          opacity="0.4"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});