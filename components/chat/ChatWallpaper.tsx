import React, { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

// Same WhatsApp-style doodle wallpaper the web chat uses (gmbt_frontend/src/components/Chats/wa-wallpaper.svg),
// drawn as a tiled SVG pattern behind the message list.
const TILE = 200; // on-screen tile size (the doodle is authored on a 260x260 grid)

const DOODLES = `
<g transform="translate(18 20)"><path d="M2 4h26a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H14l-7 6v-6H2a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"/><path d="M7 11h16M7 17h10"/></g>
<g transform="translate(98 14) rotate(12 14 14)"><path d="M14 25S3 18 3 10.5A6.2 6.2 0 0 1 14 7a6.2 6.2 0 0 1 11 3.5C25 18 14 25 14 25z"/></g>
<g transform="translate(178 18) rotate(-10 14 14)"><path d="M14 3l3.4 7 7.6 1.1-5.5 5.4 1.3 7.6L14 20.4 7.2 24.1l1.3-7.6L3 11.1 10.6 10z"/></g>
<g transform="translate(214 78) rotate(8 12 14)"><rect x="4" y="2" width="16" height="26" rx="3"/><path d="M10 24h4"/></g>
<g transform="translate(16 84)"><path d="M3 8h6l2-3h8l2 3h6a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z"/><circle cx="14" cy="16" r="5"/></g>
<g transform="translate(96 76) rotate(-8 14 14)"><path d="M26 3L2 12l8 3 3 8 4-6 7 4z"/><path d="M10 15l16-12"/></g>
<g transform="translate(168 80)"><circle cx="14" cy="14" r="12"/><path d="M9 17c1.5 3 8.5 3 10 0M10 10.5h.1M18 10.5h.1"/></g>
<g transform="translate(22 146) rotate(-6 10 14)"><path d="M8 22V5l14-3v17"/><circle cx="5" cy="22" r="3"/><circle cx="19" cy="19" r="3"/></g>
<g transform="translate(96 140)"><circle cx="14" cy="14" r="12"/><path d="M14 7v7l5 3"/></g>
<g transform="translate(172 142) rotate(6 14 14)"><rect x="3" y="11" width="22" height="14" rx="2"/><path d="M1 7h26v4H1zM14 7v18M14 7c-4-6-9-3-6 0M14 7c4-6 9-3 6 0"/></g>
<g transform="translate(212 150)"><path d="M1 3h5l3 14h13l3-10H8"/><circle cx="11" cy="22" r="2"/><circle cx="20" cy="22" r="2"/></g>
<g transform="translate(24 208) rotate(-6 12 14)"><path d="M12 27S3 17 3 11a9 9 0 0 1 18 0c0 6-9 16-9 16z"/><circle cx="12" cy="11" r="3.4"/></g>
<g transform="translate(94 210)"><rect x="2" y="5" width="26" height="18" rx="2.5"/><path d="M2 8l13 9 13-9"/></g>
<g transform="translate(172 208) rotate(10 14 14)"><circle cx="14" cy="14" r="12"/><path d="M8 14.5l4 4 8-9"/></g>
`;

const DOTS = `
<circle cx="70" cy="60" r="2"/><circle cx="150" cy="58" r="2"/><circle cx="60" cy="130" r="2"/><circle cx="148" cy="124" r="2"/>
<circle cx="236" cy="130" r="2"/><circle cx="60" cy="196" r="2"/><circle cx="148" cy="192" r="2"/><circle cx="236" cy="200" r="2"/>
<circle cx="132" cy="246" r="2"/><circle cx="240" cy="40" r="2"/>
`;

function buildXml(ink: string, opacity: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
<defs>
<pattern id="wa" x="0" y="0" width="${TILE}" height="${TILE}" viewBox="0 0 260 260" patternUnits="userSpaceOnUse">
<g fill="none" stroke="${ink}" stroke-opacity="${opacity}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${DOODLES}</g>
<g fill="${ink}" fill-opacity="${opacity}" stroke="none">${DOTS}</g>
</pattern>
</defs>
<rect x="0" y="0" width="100%" height="100%" fill="url(#wa)"/>
</svg>`;
}

interface Props {
  dark?: boolean;
}

/** Absolute-fill chat wallpaper (WhatsApp beige in light mode, deep green-black in dark mode). Never intercepts touches. */
function ChatWallpaperInner({ dark = false }: Props) {
  const xml = useMemo(
    () => (dark ? buildXml('#ffffff', 0.05) : buildXml('#0b141a', 0.075)),
    [dark],
  );
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: dark ? '#0b141a' : '#efeae2' }]}
    >
      <SvgXml xml={xml} width="100%" height="100%" />
    </View>
  );
}

export const ChatWallpaper = memo(ChatWallpaperInner);
