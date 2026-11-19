import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRTL } from '../hooks/useRTL';

/** "Opens / goes forward" chevron: points left in Hebrew (RTL) and right in LTR languages. */
export function ForwardChevron({ size = 18, color }: { size?: number; color?: string }) {
  const { isRTL } = useRTL();
  return <MaterialCommunityIcons name={isRTL ? 'chevron-left' : 'chevron-right'} size={size} color={color} />;
}
