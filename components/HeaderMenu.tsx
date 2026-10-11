import React, { useState } from 'react';
import { Menu, IconButton, Divider } from 'react-native-paper';
import { useAppTheme } from '../hooks/useAppTheme';

export interface HeaderMenuItem {
  key: string;
  title: string;
  icon?: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Skip rendering this item entirely. */
  hidden?: boolean;
  /** Draw a divider above this item. */
  dividerBefore?: boolean;
}

interface HeaderMenuProps {
  items: HeaderMenuItem[];
  iconColor?: string;
  icon?: string;
  size?: number;
}

/** The single "..." menu that holds every secondary action of a screen. */
export function HeaderMenu({ items, iconColor, icon = 'dots-vertical', size = 24 }: HeaderMenuProps) {
  const theme = useAppTheme();
  const [visible, setVisible] = useState(false);
  const shown = items.filter((i) => !i.hidden);
  if (shown.length === 0) return null;
  return (
    <Menu
      visible={visible}
      onDismiss={() => setVisible(false)}
      anchor={<IconButton icon={icon} iconColor={iconColor || theme.custom.headerText} size={size} onPress={() => setVisible(true)} />}
      contentStyle={{ backgroundColor: theme.colors.surface }}
    >
      {shown.map((item) => (
        <React.Fragment key={item.key}>
          {item.dividerBefore ? <Divider /> : null}
          <Menu.Item
            leadingIcon={item.icon}
            title={item.title}
            disabled={item.disabled}
            titleStyle={item.destructive ? { color: theme.colors.error } : undefined}
            onPress={() => {
              setVisible(false);
              // Let the menu close before running the action (avoids Alert/Modal clashes on Android).
              setTimeout(item.onPress, 60);
            }}
          />
        </React.Fragment>
      ))}
    </Menu>
  );
}

export default HeaderMenu;
