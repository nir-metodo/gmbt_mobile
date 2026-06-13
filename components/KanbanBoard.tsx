import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  LayoutChangeEvent,
  useWindowDimensions,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  GestureDetector,
  Gesture,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRTL } from '../hooks/useRTL';

const CARD_HEIGHT = 80;

export interface KanbanColumn<T = any> {
  id: string;
  title: string;
  color: string;
  icon?: string;
  items: T[];
}

interface KanbanBoardProps<T> {
  columns: KanbanColumn<T>[];
  renderCard: (item: T, columnId: string) => React.ReactNode;
  onMoveItem: (item: T, fromColumnId: string, toColumnId: string) => void;
  keyExtractor: (item: T) => string;
  emptyLabel?: string;
  columnWidth?: number;
}

export function KanbanBoard<T>({
  columns,
  renderCard,
  onMoveItem,
  keyExtractor,
  emptyLabel = 'אין פריטים',
  columnWidth: columnWidthProp,
}: KanbanBoardProps<T>) {
  const theme = useAppTheme();
  const { flexDirection, isRTL } = useRTL();
  const { t } = useTranslation();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;
  const columnWidth = columnWidthProp ?? (isLandscape ? windowWidth * 0.35 : windowWidth * 0.72);

  const [dragging, setDragging] = useState<{ item: T; fromColumnId: string } | null>(null);
  const [highlightColumn, setHighlightColumn] = useState<string | null>(null);

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const dragActive = useSharedValue(false);

  const scrollRef = useRef<ScrollView>(null);
  const columnLayouts = useRef<Map<string, { x: number; width: number }>>(new Map());
  const scrollOffset = useRef(0);
  const highlightColumnRef = useRef<string | null>(null);

  const handleColumnLayout = useCallback((columnId: string, event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    columnLayouts.current.set(columnId, { x, width });
  }, []);

  const findColumnAtX = useCallback((absoluteX: number): string | null => {
    const adjustedX = absoluteX + scrollOffset.current;
    for (const [colId, layout] of columnLayouts.current.entries()) {
      if (adjustedX >= layout.x && adjustedX <= layout.x + layout.width) {
        return colId;
      }
    }
    return null;
  }, []);

  const handleDragEnd = useCallback((item: T, fromColumnId: string) => {
    const targetColumnId = highlightColumnRef.current;
    highlightColumnRef.current = null;
    setDragging(null);
    setHighlightColumn(null);
    if (targetColumnId && targetColumnId !== fromColumnId) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        onMoveItem(item, fromColumnId, targetColumnId);
      }, 300);
    }
  }, [onMoveItem]);

  const startDrag = useCallback((item: T, fromColumnId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDragging({ item, fromColumnId });
  }, []);

  const updateHighlight = useCallback((absoluteX: number) => {
    const col = findColumnAtX(absoluteX);
    highlightColumnRef.current = col;
    setHighlightColumn(col);
  }, [findColumnAtX]);

  const animatedCardStyle = useAnimatedStyle(() => {
    if (!dragActive.value) {
      return { transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }], opacity: 1 };
    }
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { scale: scale.value },
      ],
      opacity: opacity.value,
    };
  });

  const renderDraggableCard = useCallback((item: T, columnId: string) => {
    const key = keyExtractor(item);
    const isDraggingThis = dragging && keyExtractor(dragging.item) === key;

    const gesture = Gesture.Pan()
      .activateAfterLongPress(350)
      .onStart(() => {
        dragActive.value = true;
        scale.value = withSpring(1.05);
        opacity.value = withTiming(0.85);
        runOnJS(startDrag)(item, columnId);
      })
      .onUpdate((e) => {
        translateX.value = e.translationX;
        translateY.value = e.translationY;
        runOnJS(updateHighlight)(e.absoluteX);
      })
      .onEnd(() => {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        scale.value = withSpring(1);
        opacity.value = withTiming(1);
        dragActive.value = false;
        runOnJS(handleDragEnd)(item, columnId);
      })
      .onFinalize(() => {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        scale.value = withSpring(1);
        opacity.value = withTiming(1);
        dragActive.value = false;
      });

    return (
      <GestureDetector key={key} gesture={gesture}>
        <Animated.View style={isDraggingThis ? [animatedCardStyle, { zIndex: 9999, elevation: 10 }] : undefined}>
          {renderCard(item, columnId)}
        </Animated.View>
      </GestureDetector>
    );
  }, [dragging, keyExtractor, renderCard, startDrag, updateHighlight, handleDragEnd, animatedCardStyle, dragActive, translateX, translateY, scale, opacity]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.container}
        onScroll={(e) => { scrollOffset.current = e.nativeEvent.contentOffset.x; }}
        scrollEventThrottle={16}
        scrollEnabled={!dragging}
      >
        {columns.map((column) => {
          const isHighlighted = highlightColumn === column.id && dragging && dragging.fromColumnId !== column.id;
          return (
            <View
              key={column.id}
              style={[styles.column, { width: columnWidth }]}
              onLayout={(e) => handleColumnLayout(column.id, e)}
            >
              <View
                style={[
                  styles.columnHeader,
                  {
                    backgroundColor: `${column.color}15`,
                    borderBottomColor: column.color,
                  },
                  isHighlighted && styles.columnHighlight,
                ]}
              >
                <View style={[styles.columnHeaderInner, { flexDirection }]}>
                  {column.icon && (
                    <MaterialCommunityIcons
                      name={column.icon as any}
                      size={16}
                      color={column.color}
                    />
                  )}
                  <Text
                    variant="labelLarge"
                    style={{ color: column.color, fontWeight: '700', flex: 1 }}
                    numberOfLines={1}
                  >
                    {column.title}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: `${column.color}25` }]}>
                    <Text variant="labelSmall" style={{ color: column.color, fontWeight: '700' }}>
                      {column.items.length}
                    </Text>
                  </View>
                </View>
                {isHighlighted && (
                  <View style={[styles.dropIndicator, { backgroundColor: column.color }]}>
                    <MaterialCommunityIcons name="arrow-down" size={14} color="#fff" />
                    <Text style={styles.dropText}>{t('kanban.dropHereShort', isRTL ? 'שחרר כאן' : 'Drop here')}</Text>
                  </View>
                )}
              </View>

              <ScrollView
                style={styles.columnBody}
                contentContainerStyle={styles.columnContent}
                showsVerticalScrollIndicator={false}
                scrollEnabled={!dragging}
              >
                {isHighlighted && (
                  <View style={[styles.dropZone, { borderColor: column.color, backgroundColor: `${column.color}12` }]}>
                    <MaterialCommunityIcons name="tray-arrow-down" size={22} color={column.color} />
                    <Text style={[styles.dropZoneText, { color: column.color }]}>
                      {t('kanban.dropHere', isRTL ? 'גרור ושחרר כאן' : 'Drag & drop here')}
                    </Text>
                  </View>
                )}
                {column.items.length === 0 ? (
                  !isHighlighted ? (
                    <View style={styles.emptyColumn}>
                      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
                        {emptyLabel}
                      </Text>
                    </View>
                  ) : null
                ) : (
                  column.items.map((item) => renderDraggableCard(item, column.id))
                )}
              </ScrollView>
            </View>
          );
        })}
      </ScrollView>

      {dragging && (
        <View style={styles.dragHint}>
          <MaterialCommunityIcons name="gesture-swipe" size={16} color="#fff" />
          <Text style={styles.dragHintText}>
            {t('kanban.dragToColumn', isRTL ? 'גרור לעמודה אחרת לשינוי שלב' : 'Drag to another column to change stage')}
          </Text>
        </View>
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingTop: 8,
    gap: 10,
  },
  column: {
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  columnHeader: {
    padding: 12,
    borderBottomWidth: 2,
  },
  columnHeaderInner: {
    alignItems: 'center',
    gap: 8,
  },
  columnHighlight: {
    backgroundColor: 'rgba(37, 211, 102, 0.12)',
    borderBottomColor: '#25D366',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 24,
    alignItems: 'center',
  },
  columnBody: {
    flex: 1,
    maxHeight: 500,
  },
  columnContent: {
    padding: 8,
    gap: 8,
  },
  emptyColumn: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  dropZone: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 22,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 8,
  },
  dropZoneText: {
    fontSize: 13,
    fontWeight: '700',
  },
  dropIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignSelf: 'center',
  },
  dropText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  dragHint: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  dragHintText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
});

export default KanbanBoard;
