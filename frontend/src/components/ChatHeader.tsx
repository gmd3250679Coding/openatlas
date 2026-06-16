import { useCallback, useEffect, useRef, useState } from 'react';
import AtlasOrb from './AtlasOrb';

// ============================================================
// ChatHeader — 3 styles, 5 pixel pets at 32×32 (rendered @96px)
//
// Pet upgrades over v1:
//   • Two-tone palette per pet (body + accent)
//   • Eye blink on idle (interrupts every 4-7s)
//   • Sub-pixel "breathing" sway (1px translateY)
//   • Hover → wiggle, click → jump
//   • State-triggered overlays (z's for thinking, sweat for dispatch)
//
// Bitmap encoding:
//   Each row is uint32 hex; bits 0-31 left to right.
//   We additionally support an "accent" mask per state to
//   highlight specific pixels (eyes, cheeks, badge, etc).
// ============================================================

type OrbState = 'idle' | 'thinking' | 'dispatch' | 'speaking';
export type HeaderStyle = 'pixel' | 'aura' | 'hud';
export type Pet = 'marmot' | 'robot' | 'monkey' | 'turtle' | 'panda';
/**
 * Phase B (2026-06-04):Profile chip
 *   'read-only' → 橙色 #F59E0B,头像右下角 14×14 圆角徽章
 *   'audit'     → 蓝色 #3B82F6,头像右下角 14×14 圆角徽章
 *   'normal'    → 无徽章
 *
 * 视觉来源:DESIGN.md §6.4 / token --profile-readonly / --profile-audit
 */
export type ProfileMode = 'normal' | 'read-only' | 'audit';

const PROFILE_BADGE: Record<Exclude<ProfileMode, 'normal'>, { color: string; label: string }> = {
  'read-only': { color: 'var(--profile-readonly, #F59E0B)', label: 'RO' },
  'audit':     { color: 'var(--profile-audit, #3B82F6)',     label: 'AU' },
};

const STYLES: HeaderStyle[] = ['pixel', 'aura', 'hud'];
const STYLE_CHARS = { pixel: '像素', aura: '氛围', hud: 'HUD' } as const;
const PET_NAMES = { marmot: '呆萌土拨鼠', robot: '电子兔', monkey: '元气狐', turtle: '赛博龟', panda: '熊猫仔' } as const;
const SIZE = 32; // grid
const RENDER_SIZE = 96; // CSS px

interface Props {
  orbState: OrbState; style: HeaderStyle; onStyleChange: (s: HeaderStyle) => void;
  pet: Pet; onPetChange: (p: Pet) => void;
  petAwakeSignal?: string;
  profile?: ProfileMode;
}

type Bitmap = number[]; // length 32, each = uint32

function bitPixels(row: number): boolean[] {
  const bits: boolean[] = [];
  for (let c = 31; c >= 0; c--) bits.push(((row >>> c) & 1) === 1);
  return bits;
}

// ─── Per-pet color palette ──────────────────────────────────
// `body` = main fill, `accent` = highlight (eyes, cheeks, etc),
// `dark` = outline / shadow side
const PET_PALETTE: Record<Pet, { body: string; accent: string; dark: string; eye: string }> = {
  marmot: { body: '#D8A56F', accent: '#F5C88E', dark: '#6B3F22', eye: '#15100B' },
  robot:  { body: '#DDEBFF', accent: '#8B7FE8', dark: '#6C77D9', eye: '#2D2A78' },
  monkey: { body: '#F09A4A', accent: '#FFE0B2', dark: '#9A4A1E', eye: '#24130A' },
  turtle: { body: '#7CCB8A', accent: '#B7F3C8', dark: '#2F7A55', eye: '#0B2415' },
  panda:  { body: '#FFF9EF', accent: '#2B2D42', dark: '#B8AFA0', eye: '#111827' },
};

// ─── Eye position per pet (col, row in 32-grid) ─────────────
const PET_EYES: Record<Pet, [[number, number], [number, number]]> = {
  marmot: [[11, 13], [20, 13]],
  robot:  [[12, 14], [19, 14]],
  monkey: [[12, 16], [19, 16]],
  turtle: [[12, 26], [19, 26]],
  panda:  [[11, 14], [20, 14]],
};

// ─── Mouth pixel coords per state per pet ───────────────────
// Each entry is a list of (col,row) pixels painted on top of the
// body silhouette. This is how we differentiate idle / thinking /
// dispatch / speaking without needing fully separate bitmaps.
type MouthSet = Record<OrbState, Array<[number, number]>>;
const PET_MOUTHS: Record<Pet, MouthSet> = {
  marmot: {
    idle:     [[14, 16], [15, 16], [16, 16], [17, 16], [15, 17], [16, 17]],
    thinking: [[15, 16], [16, 16]],
    dispatch: [[13, 16], [14, 16], [15, 16], [16, 16], [17, 16], [18, 16]],
    speaking: [[13, 16], [14, 16], [15, 16], [16, 16], [17, 16], [18, 16],
               [13, 17], [18, 17], [13, 18], [14, 18], [15, 18], [16, 18], [17, 18], [18, 18]],
  },
  robot: {
    idle:     [[12, 18], [13, 18], [14, 18], [15, 18], [16, 18], [17, 18], [18, 18], [19, 18]],
    thinking: [[12, 18], [14, 18], [16, 18], [18, 18]],
    dispatch: [[10, 18], [11, 18], [12, 18], [13, 18], [14, 18], [15, 18], [16, 18], [17, 18], [18, 18], [19, 18], [20, 18], [21, 18]],
    speaking: [[12, 18], [13, 18], [14, 18], [15, 18], [16, 18], [17, 18], [18, 18], [19, 18],
               [13, 19], [14, 19], [15, 19], [16, 19], [17, 19], [18, 19],
               [12, 20], [13, 20], [14, 20], [15, 20], [16, 20], [17, 20], [18, 20], [19, 20]],
  },
  monkey: {
    idle:     [[14, 22], [15, 22], [16, 22], [17, 22]],
    thinking: [[15, 22], [16, 22]],
    dispatch: [[13, 22], [14, 22], [15, 22], [16, 22], [17, 22], [18, 22]],
    speaking: [[13, 22], [14, 22], [15, 22], [16, 22], [17, 22], [18, 22],
               [13, 23], [18, 23], [14, 24], [15, 24], [16, 24], [17, 24]],
  },
  turtle: {
    idle:     [[14, 23], [15, 23], [16, 23], [17, 23]],
    thinking: [[15, 23], [16, 23]],
    dispatch: [[13, 23], [14, 23], [15, 23], [16, 23], [17, 23], [18, 23]],
    speaking: [[13, 23], [14, 23], [15, 23], [16, 23], [17, 23], [18, 23],
               [13, 24], [14, 24], [17, 24], [18, 24]],
  },
  panda: {
    idle:     [[14, 20], [15, 20], [16, 20], [17, 20]],
    thinking: [[15, 20], [16, 20]],
    dispatch: [[13, 20], [14, 20], [15, 20], [16, 20], [17, 20], [18, 20]],
    speaking: [[13, 20], [14, 20], [15, 20], [16, 20], [17, 20], [18, 20],
               [13, 21], [18, 21], [13, 22], [14, 22], [15, 22], [16, 22], [17, 22], [18, 22]],
  },
};

// ─── Pet-specific accent pixels (paint with palette.accent) ──
// Robot chest LED, panda ear/eye-patch black, monkey snout, turtle shell shading.
const PET_ACCENTS: Record<Pet, Array<[number, number]>> = {
  marmot: [[15, 22], [16, 22]], // belly button area
  robot:  [[15, 21], [16, 21], [15, 22], [16, 22]], // chest LED
  monkey: [[12, 21], [13, 21], [14, 21], [15, 21], [16, 21], [17, 21], [18, 21], [19, 21],
           [11, 22], [20, 22], [11, 23], [20, 23], [11, 24], [20, 24],
           [12, 25], [13, 25], [14, 25], [15, 25], [16, 25], [17, 25], [18, 25], [19, 25]], // snout patch
  turtle: [[8, 11], [12, 11], [16, 11], [20, 11], [24, 11],
           [10, 13], [14, 13], [18, 13], [22, 13],
           [8, 15], [12, 15], [16, 15], [20, 15], [24, 15]], // shell hex spots
  panda:  [[3, 3], [4, 3], [5, 3], [6, 3], [25, 3], [26, 3], [27, 3], [28, 3],
           [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [25, 4], [26, 4], [27, 4], [28, 4], [29, 4],
           [1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [25, 5], [26, 5], [27, 5], [28, 5], [29, 5], [30, 5],
           [2, 6], [3, 6], [4, 6], [5, 6], [26, 6], [27, 6], [28, 6], [29, 6],
           [9, 13], [10, 13], [11, 13], [12, 13], [13, 13],
           [18, 13], [19, 13], [20, 13], [21, 13], [22, 13],
           [8, 14], [9, 14], [10, 14], [11, 14], [12, 14], [13, 14],
           [18, 14], [19, 14], [20, 14], [21, 14], [22, 14], [23, 14],
           [8, 15], [9, 15], [10, 15], [11, 15], [12, 15], [13, 15],
           [18, 15], [19, 15], [20, 15], [21, 15], [22, 15], [23, 15],
           [9, 16], [10, 16], [11, 16], [12, 16], [13, 16],
           [18, 16], [19, 16], [20, 16], [21, 16], [22, 16]], // ear tabs + eye patches
};

// ─── Cheek/blush position (idle accent) ─────────────────────
const PET_CHEEKS: Record<Pet, [[number, number], [number, number]] | null> = {
  marmot: [[8, 14], [23, 14]],
  robot:  null,
  monkey: [[7, 17], [24, 17]],
  turtle: null,
  panda:  null,
};

// ─── Bitmaps (kept from v1; selecting only 4 states each) ───
const MARMOT: Record<OrbState, Bitmap> = {
  idle: [
    0x00000000,0x00000000,0x00000000,0x00700700,0x00780F00,0x003C1E00,
    0x001FFE00,0x007FFF80,0x00FFFFC0,0x01FFFFE0,0x01FFFFE0,0x03FFFFF0,
    0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,
    0x03FFFFF0,0x06FFFFF6,0x06FFFFF6,0x07FFFFF8,0x07FFFFF8,0x07FFFFF8,
    0x07FFFFF8,0x0FFCCFFC,0x0FFCCFFC,0x07FEDFF8,0x07FE7FE0,0x03FF3FF0,
    0x01F81F80,0x00000000,
  ],
  thinking: [
    0x00000000,0x00000000,0x00000000,0x00700700,0x00780F00,0x003C1E00,
    0x001FFE00,0x007FFF80,0x00FFFFC0,0x01FFFFE0,0x01FFFFE0,0x03FFFFF0,
    0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,
    0x03FFFFF0,0x06FFFFF6,0x06FFFFF6,0x07FFFFF8,0x07FFFFF8,0x07FFFFF8,
    0x07FFFFF8,0x0FFCCFFC,0x0FFCCFFC,0x07FEDFF8,0x07FE7FE0,0x03FF3FF0,
    0x01F81F80,0x00000000,
  ],
  dispatch: [
    0x00000000,0x00000000,0x00000000,0x00700700,0x00780F00,0x003C1E00,
    0x001FFE00,0x007FFF80,0x00FFFFC0,0x01FFFFE0,0x01FFFFE0,0x03FFFFF0,
    0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,
    0x03FFFFF0,0x6FFFFFF6,0x6FFFFFF6,0x07FFFFF8,0x07FFFFF8,0x07FFFFF8,
    0x07FFFFF8,0x0FFCCFFC,0x0FFCCFFC,0x07FEDFF8,0x07FE7FE0,0x03FF3FF0,
    0x01F81F80,0x00000000,
  ],
  speaking: [
    0x00000000,0x00000000,0x00000000,0x00700700,0x00780F00,0x003C1E00,
    0x001FFE00,0x007FFF80,0x00FFFFC0,0x01FFFFE0,0x01FFFFE0,0x03FFFFF0,
    0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,
    0x03FFFFF0,0x06FFFFF6,0x06FFFFF6,0x07FFFFF8,0x07FFFFF8,0x07FFFFF8,
    0x07FFFFF8,0x0FFCCFFC,0x0FFCCFFC,0x07FEDFF8,0x07FE7FE0,0x03FF3FF0,
    0x01F81F80,0x00000000,
  ],
};

const ROBOT: Record<OrbState, Bitmap> = {
  idle: [
    0x00000000,0x00000000,0x0000C000,0x0000C000,0x0000C000,0x0003F000,
    0x0003F000,0x0003F000,0x003FFF00,0x003FFF00,0x007FFF80,0x007FFF80,
    0x007FFF80,0x007FFF80,0x007FFF80,0x007FFF80,0x007FFF80,0x007FFF80,
    0x007FFF80,0x007FFF80,0x007FFF80,0x007FFF80,0x067FFF98,0x0F7FFFBC,
    0x0F7FFFBC,0x0F7FFFBC,0x067FFF98,0x007FFF80,0x0073FCC0,0x0073FCC0,
    0x00F807C0,0x00F807C0,
  ],
  thinking: [
    0x00000000,0x00000000,0x00004000,0x00004000,0x0000E000,0x0003F000,
    0x0003F000,0x0003F000,0x003FFF00,0x003FFF00,0x007FFF80,0x007FFF80,
    0x007FFF80,0x007FFF80,0x007FFF80,0x007FFF80,0x007FFF80,0x007FFF80,
    0x007FFF80,0x007FFF80,0x007FFF80,0x007FFF80,0x067FFF98,0x0F7FFFBC,
    0x0F7FFFBC,0x0F7FFFBC,0x067FFF98,0x007FFF80,0x0073FCC0,0x0073FCC0,
    0x00F807C0,0x00F807C0,
  ],
  dispatch: [
    0x00000000,0x00000000,0x0001E000,0x0001E000,0x0007F800,0x0003F000,
    0x0003F000,0x0003F000,0x003FFF00,0x003FFF00,0x007FFF80,0x007FFF80,
    0x007FFF80,0x007FFF80,0x007FFF80,0x007FFF80,0x007FFF80,0x007FFF80,
    0x007FFF80,0x007FFF80,0x007FFF80,0x7FFFFFFE,0x7FFFFFFE,0x7FFFFFFE,
    0x0F7FFFBC,0x0F7FFFBC,0x067FFF98,0x007FFF80,0x0073FCC0,0x0073FCC0,
    0x00F807C0,0x00F807C0,
  ],
  speaking: [
    0x00000000,0x00000000,0x0000C000,0x0000C000,0x0000C000,0x0003F000,
    0x0003F000,0x0003F000,0x003FFF00,0x003FFF00,0x007FFF80,0x007FFF80,
    0x007FFF80,0x007FFF80,0x007FFF80,0x007FFF80,0x007FFF80,0x007FFF80,
    0x007FFF80,0x007FFF80,0x007FFF80,0x007FFF80,0x067FFF98,0x0F7FFFBC,
    0x0F7FFFBC,0x0F7FFFBC,0x067FFF98,0x007FFF80,0x0073FCC0,0x0073FCC0,
    0x00F807C0,0x00F807C0,
  ],
};

const MONKEY: Record<OrbState, Bitmap> = {
  idle: [
    0x00000000,0x00000000,0x00000000,0x00000000,0x078001E0,0x0FC003F0,
    0x1FE007F8,0x1FE007F8,0x1FE007F8,0x0FC000FC,0x07E001F8,0x01FFFE00,
    0x03FFFF00,0x07FFFF80,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,
    0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,
    0x0FFFFFC0,0x07FFFF80,0x03FFFF00,0x01FFFE00,0x07E01F80,0x0FC00FC0,
    0x07800780,0x00000000,
  ],
  thinking: [
    0x00000000,0x00000000,0x00000000,0x00000000,0x078001E0,0x0FC003F0,
    0x1FE007F8,0x1FE007F8,0x1FE007F8,0x0FC000FC,0x07E001F8,0x01FFFE00,
    0x03FFFF00,0x07FFFF80,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,
    0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,
    0x0FFFFFC0,0x07FFFF80,0x03FFFF00,0x01FFFE00,0x07E01F80,0x0FC00FC0,
    0x07800780,0x00000000,
  ],
  dispatch: [
    0x00000000,0x00000000,0x00078000,0x000F0000,0x001E0000,0x0FC003F0,
    0x1FE007F8,0x1FE007F8,0x1FE007F8,0x0FC000FC,0x07E001F8,0x01FFFE00,
    0x03FFFF00,0x07FFFF80,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,
    0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,
    0x0FFFFFC0,0x07FFFF80,0x03FFFF00,0x01FFFE00,0x07E01F80,0x0FC00FC0,
    0x07800780,0x00000000,
  ],
  speaking: [
    0x00000000,0x00000000,0x00000000,0x00000000,0x078001E0,0x0FC003F0,
    0x1FE007F8,0x1FE007F8,0x1FE007F8,0x0FC000FC,0x07E001F8,0x01FFFE00,
    0x03FFFF00,0x07FFFF80,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,
    0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,0x0FFFFFC0,
    0x0FFFFFC0,0x07FFFF80,0x03FFFF00,0x01FFFE00,0x07E01F80,0x0FC00FC0,
    0x07800780,0x00000000,
  ],
};

const TURTLE: Record<OrbState, Bitmap> = {
  idle: [
    0x00000000,0x00000000,0x00000000,0x00000000,0x00000000,0x0003F000,
    0x000FFC00,0x007FFF80,0x01F9F9F8,0x03FFFFFC,0x07FFFFFE,0x0FFFFFFF,
    0x0FFFFFFF,0x0FFFFFFF,0x07FFFFFE,0x03FFFFFC,0x01FFFFF8,0x00FFFFF0,
    0x007FFFE0,0x007FFFE0,0x003FFFC0,0x003FFFC0,0x003FFFC0,0x003FFFC0,
    0x003FFFC0,0x000FFF00,0x0187F860,0x01B7FB60,0x01B7FB60,0x01E7F9E0,
    0x00000000,0x00000000,
  ],
  thinking: [
    0x00000000,0x00000000,0x00000000,0x00000000,0x00000000,0x0003F000,
    0x000FFC00,0x007FFF80,0x01F9F9F8,0x03FFFFFC,0x07FFFFFE,0x0FFFFFFF,
    0x0FFFFFFF,0x0FFFFFFF,0x07FFFFFE,0x03FFFFFC,0x01FFFFF8,0x00FFFFF0,
    0x007FFFE0,0x007FFFE0,0x003FFFC0,0x003FFFC0,0x003FFFC0,0x003FFFC0,
    0x003FFFC0,0x000FFF00,0x0187F860,0x01B7FB60,0x01B7FB60,0x01E7F9E0,
    0x00000000,0x00000000,
  ],
  dispatch: [
    0x00000000,0x00000000,0x00000000,0x00000000,0x00000000,0x0003F000,
    0x000FFC00,0x007FFF80,0x01F9F9F8,0x03FFFFFC,0x07FFFFFE,0x0FFFFFFF,
    0x0FFFFFFF,0x0FFFFFFF,0x07FFFFFE,0x03FFFFFC,0x01FFFFF8,0x00FFFFF0,
    0x007FFFE0,0x007FFFE0,0x003FFFC0,0x003FFFC0,0x003FFFC0,0x003FFFC0,
    0x003FFFC0,0x000FFF00,0x0C3FCFF0,0x0C3FCFF0,0x0DBFCFF6,0x0F3FCFF0,
    0x00000000,0x00000000,
  ],
  speaking: [
    0x00000000,0x00000000,0x00000000,0x00000000,0x00000000,0x0003F000,
    0x000FFC00,0x007FFF80,0x01F9F9F8,0x03FFFFFC,0x07FFFFFE,0x0FFFFFFF,
    0x0FFFFFFF,0x0FFFFFFF,0x07FFFFFE,0x03FFFFFC,0x01FFFFF8,0x00FFFFF0,
    0x007FFFE0,0x007FFFE0,0x003FFFC0,0x003FFFC0,0x003FFFC0,0x003FFFC0,
    0x003FFFC0,0x000FFF00,0x0187F860,0x01B7FB60,0x01B7FB60,0x01E7F9E0,
    0x00000000,0x00000000,
  ],
};

const PANDA: Record<OrbState, Bitmap> = {
  idle: [
    0x00000000,0x00000000,0x00000000,0x1E0000F0,0x3F0001F8,0x7E0000FC,
    0x3C000078,0x0FFFFFFF,0x0FFFFFFF,0x0FFFFFFC,0x07FFFFF8,0x03FFFFF0,
    0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,
    0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFFC,0x03FFFFFC,0x03FFFFFC,
    0x03FFFFFC,0x07FFFFFE,0x07FFFFFE,0x03FFFFFC,0x01FFFFF8,0x03F3F3F0,
    0x01E1E1E0,0x00000000,
  ],
  thinking: [
    0x00000000,0x00000000,0x00000000,0x1E0000F0,0x3F0001F8,0x7E0000FC,
    0x3C000078,0x0FFFFFFF,0x0FFFFFFF,0x0FFFFFFC,0x07FFFFF8,0x03FFFFF0,
    0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,
    0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFFC,0x03FFFFFC,0x03FFFFFC,
    0x03FFFFFC,0x07FFFFFE,0x07FFFFFE,0x03FFFFFC,0x01FFFFF8,0x03F3F3F0,
    0x01E1E1E0,0x00000000,
  ],
  dispatch: [
    0x00000000,0x00000000,0x00000000,0x1E0000F0,0x3F0001F8,0x7E0000FC,
    0x3C000078,0x0FFFFFFF,0x0FFFFFFF,0x0FFFFFFC,0x07FFFFF8,0x03FFFFF0,
    0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,
    0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFFC,0x03FFFFFC,0x03FFFFFC,
    0x6FFFFFFD,0x6FFFFFFD,0x07FFFFFE,0x03FFFFFC,0x01FFFFF8,0x03F3F3F0,
    0x01E1E1E0,0x00000000,
  ],
  speaking: [
    0x00000000,0x00000000,0x00000000,0x1E0000F0,0x3F0001F8,0x7E0000FC,
    0x3C000078,0x0FFFFFFF,0x0FFFFFFF,0x0FFFFFFC,0x07FFFFF8,0x03FFFFF0,
    0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,
    0x03FFFFF0,0x03FFFFF0,0x03FFFFF0,0x03FFFFFC,0x03FFFFFC,0x03FFFFFC,
    0x03FFFFFC,0x07FFFFFE,0x07FFFFFE,0x03FFFFFC,0x01FFFFF8,0x03F3F3F0,
    0x01E1E1E0,0x00000000,
  ],
};

const PET_DATA: Record<Pet, Record<OrbState, Bitmap>> = {
  marmot: MARMOT, robot: ROBOT, monkey: MONKEY, turtle: TURTLE, panda: PANDA,
};

const MARMOT_SVG = {
  breathing: '/assets/marmot-pet/e_pet_state_breathing.svg',
  blink: '/assets/marmot-pet/e_pet_state_blink.svg',
  sleeping: '/assets/marmot-pet/e_pet_state_sleeping.svg',
  talkingA: '/assets/marmot-pet/e_pet_state_talking_a.svg',
  talkingB: '/assets/marmot-pet/e_pet_state_talking_b.svg',
  thinking: '/assets/marmot-pet/e_pet_state_thinking.svg',
} as const;

function MarmotSvgPet({ state, hovered, jumping, awakeSignal }: { state: OrbState; hovered: boolean; jumping: boolean; awakeSignal?: string }) {
  const [blink, setBlink] = useState(false);
  const [isAwake, setIsAwake] = useState(false);
  const sleepTimerRef = useRef<number | null>(null);
  const didMountRef = useRef(false);

  const scheduleSleep = useCallback(() => {
    if (sleepTimerRef.current !== null) window.clearTimeout(sleepTimerRef.current);
    sleepTimerRef.current = window.setTimeout(() => {
      setIsAwake(false);
      sleepTimerRef.current = null;
    }, 60_000);
  }, []);

  useEffect(() => {
    return () => {
      if (sleepTimerRef.current !== null) window.clearTimeout(sleepTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (state !== 'idle') {
      setIsAwake(true);
      scheduleSleep();
    }
  }, [state, scheduleSleep]);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    setIsAwake(true);
    scheduleSleep();
  }, [awakeSignal, scheduleSleep]);

  useEffect(() => {
    if (state !== 'idle' || !isAwake) return;
    let timeout: number;
    const tick = () => {
      setBlink(true);
      window.setTimeout(() => setBlink(false), 140);
      timeout = window.setTimeout(tick, 1300 + Math.random() * 1500);
    };
    timeout = window.setTimeout(tick, 650 + Math.random() * 850);
    return () => window.clearTimeout(timeout);
  }, [state, isAwake]);

  const isSleeping = state === 'idle' && !isAwake;
  const isTalking = state === 'speaking' || state === 'dispatch';
  const src = isSleeping
    ? MARMOT_SVG.sleeping
    : state === 'thinking'
    ? MARMOT_SVG.thinking
    : blink
      ? MARMOT_SVG.blink
      : MARMOT_SVG.breathing;

  const anim = isSleeping ? 'marmot-svg-sleeping'
    : state === 'dispatch' ? 'marmot-svg-dispatch'
    : state === 'thinking' ? 'marmot-svg-thinking'
    : state === 'speaking' ? 'marmot-svg-speaking'
    : 'marmot-svg-breathe';

  const statusText = isSleeping ? '休眠中'
    : state === 'idle' ? '待命'
    : state === 'thinking' ? '思考中'
    : state === 'dispatch' ? '调度中'
    : '回复中';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div
        className={`marmot-svg-stage ${anim} ${hovered ? 'marmot-svg-wiggle' : ''} ${jumping ? 'marmot-svg-jump' : ''}`}
      >
        <div className="marmot-svg-shadow" />
        {isTalking ? (
          <>
            <img className="marmot-svg-frame marmot-svg-talk-a" src={MARMOT_SVG.talkingA} alt="" draggable={false} />
            <img className="marmot-svg-frame marmot-svg-talk-b" src={MARMOT_SVG.talkingB} alt="" draggable={false} />
          </>
        ) : (
          <img className="marmot-svg-frame" src={src} alt="" draggable={false} />
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.2 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>Atlas</div>
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {statusText}
        </div>
        <div style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)', opacity: 0.72, marginTop: 2 }}>
          呆萌土拨鼠 · svg
        </div>
      </div>

      <style>{`
        .marmot-svg-stage {
          width: ${RENDER_SIZE}px;
          height: ${RENDER_SIZE}px;
          position: relative;
          flex-shrink: 0;
          transform-origin: 50% 78%;
          user-select: none;
        }
        .marmot-svg-frame {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: contain;
          pointer-events: none;
          filter: drop-shadow(0 6px 10px rgba(15,23,42,0.16));
          image-rendering: auto;
        }
        .marmot-svg-shadow {
          position: absolute;
          left: 50%;
          bottom: 4px;
          width: 58px;
          height: 7px;
          border-radius: 999px;
          background: radial-gradient(ellipse, rgba(15,23,42,0.22), transparent 70%);
          transform: translateX(-50%);
          opacity: 0.7;
        }
        .marmot-svg-talk-a { animation: marmot-talk-a 0.36s steps(1) infinite; }
        .marmot-svg-talk-b { animation: marmot-talk-b 0.36s steps(1) infinite; }
        .marmot-svg-sleeping { animation: marmot-svg-sleeping-kf 3.4s ease-in-out infinite; }
        .marmot-svg-breathe { animation: marmot-svg-breathe-kf 2.8s ease-in-out infinite; }
        .marmot-svg-thinking { animation: marmot-svg-thinking-kf 1.8s ease-in-out infinite; }
        .marmot-svg-dispatch { animation: marmot-svg-dispatch-kf 0.62s ease-in-out infinite; }
        .marmot-svg-speaking { animation: marmot-svg-speaking-kf 0.42s ease-in-out infinite; }
        .marmot-svg-wiggle { animation: marmot-svg-wiggle-kf 0.52s ease-in-out 1; }
        .marmot-svg-jump { animation: marmot-svg-jump-kf 0.5s ease-out 1; }
        @keyframes marmot-talk-a {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes marmot-talk-b {
          0%, 49% { opacity: 0; }
          50%, 100% { opacity: 1; }
        }
        @keyframes marmot-svg-breathe-kf {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-2px) scale(1.015, 0.99); }
        }
        @keyframes marmot-svg-sleeping-kf {
          0%, 100% { transform: rotate(-1.2deg) translateY(0); }
          50% { transform: rotate(1.2deg) translateY(-1px); }
        }
        @keyframes marmot-svg-thinking-kf {
          0%, 100% { transform: rotate(-2deg) translateY(0); }
          50% { transform: rotate(2deg) translateY(-2px); }
        }
        @keyframes marmot-svg-dispatch-kf {
          0%, 100% { transform: translateX(0) translateY(0); }
          25% { transform: translateX(-1.5px) translateY(-1px); }
          50% { transform: translateX(1.5px) translateY(0); }
          75% { transform: translateX(-1px) translateY(-1px); }
        }
        @keyframes marmot-svg-speaking-kf {
          0%, 100% { transform: scale(1, 1); }
          50% { transform: scale(1.025, 0.985); }
        }
        @keyframes marmot-svg-wiggle-kf {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-4deg); }
          75% { transform: rotate(4deg); }
        }
        @keyframes marmot-svg-jump-kf {
          0%, 100% { transform: translateY(0); }
          42% { transform: translateY(-12px); }
          64% { transform: translateY(-7px); }
        }
      `}</style>
    </div>
  );
}

function PetFaceOverlay({ pet, state, blink }: { pet: Pet; state: OrbState; blink: boolean }) {
  const moodClass = state === 'speaking' ? 'is-speaking' : state === 'thinking' ? 'is-thinking' : state === 'dispatch' ? 'is-dispatch' : '';
  const blinkClass = blink ? 'is-blink' : '';

  if (pet === 'marmot') {
    return (
      <div className={`pp-face pp-face-marmot ${moodClass} ${blinkClass}`} aria-hidden="true">
        <span className="pp-ear left" />
        <span className="pp-ear right" />
        <span className="pp-eye left"><i /></span>
        <span className="pp-eye right"><i /></span>
        <span className="pp-nose" />
        <span className="pp-mouth" />
        <span className="pp-arm left" />
        <span className="pp-arm right" />
      </div>
    );
  }

  if (pet === 'robot') {
    return (
      <div className={`pp-face pp-face-robot ${moodClass} ${blinkClass}`} aria-hidden="true">
        <span className="pp-antenna" />
        <span className="pp-ear left" />
        <span className="pp-ear right" />
        <span className="pp-screen">
          <i className="left" />
          <i className="right" />
          <b />
        </span>
        <span className="pp-glow" />
      </div>
    );
  }

  if (pet === 'monkey') {
    return (
      <div className={`pp-face pp-face-fox ${moodClass} ${blinkClass}`} aria-hidden="true">
        <span className="pp-ear left" />
        <span className="pp-ear right" />
        <span className="pp-muzzle" />
        <span className="pp-eye left"><i /></span>
        <span className="pp-eye right"><i /></span>
        <span className="pp-nose" />
        <span className="pp-mouth" />
      </div>
    );
  }

  if (pet === 'turtle') {
    return (
      <div className={`pp-face pp-face-turtle ${moodClass} ${blinkClass}`} aria-hidden="true">
        <span className="pp-shell" />
        <span className="pp-eye left"><i /></span>
        <span className="pp-eye right"><i /></span>
        <span className="pp-mouth" />
        <span className="pp-fin left" />
        <span className="pp-fin right" />
      </div>
    );
  }

  return (
    <div className={`pp-face pp-face-panda ${moodClass} ${blinkClass}`} aria-hidden="true">
      <span className="pp-ear left" />
      <span className="pp-ear right" />
      <span className="pp-patch left"><i /></span>
      <span className="pp-patch right"><i /></span>
      <span className="pp-nose" />
      <span className="pp-mouth" />
    </div>
  );
}

// ============================================================
// Pixel Pet renderer
// — supports two-tone palette (body/dark) by checking
//   "is this pixel adjacent to a transparent pixel?" → that's the edge,
//   gets the dark color. Otherwise body color.
// — overlays eye dots on top using PET_EYES coords.
// — blink animation hides eye pixels every 4-7s for 0.12s.
// ============================================================
function PixelPet({ state, pet, hovered, jumping }: { state: OrbState; pet: Pet; hovered: boolean; jumping: boolean }) {
  const bitmap = PET_DATA[pet][state];
  const palette = PET_PALETTE[pet];
  const eyes = PET_EYES[pet];
  const cheeks = PET_CHEEKS[pet];

  // Blink state — only for idle
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (state !== 'idle') return;
    let timeout: number;
    const tick = () => {
      setBlink(true);
      window.setTimeout(() => setBlink(false), 130);
      timeout = window.setTimeout(tick, 3500 + Math.random() * 3500);
    };
    timeout = window.setTimeout(tick, 1500 + Math.random() * 2500);
    return () => window.clearTimeout(timeout);
  }, [state]);

  // Pre-compute bit grid
  const grid: boolean[][] = bitmap.map(r => bitPixels(r));
  // Edge detection helper — a body pixel is "edge" if any 4-neighbor is empty
  const isEdge = (r: number, c: number) =>
    grid[r][c] && (
      r === 0 || r === SIZE - 1 || c === 0 || c === SIZE - 1 ||
      !grid[r - 1]?.[c] || !grid[r + 1]?.[c] ||
      !grid[r]?.[c - 1] || !grid[r]?.[c + 1]
    );

  // Belly-shading: bottom 3 rows of body get a hint of dark
  const isBelly = (r: number, _c: number) => grid[r] && r >= SIZE - 5 && r < SIZE - 1 && grid[r][_c];

  // Build pixel render array
  const pixels: { r: number; c: number; color: string }[] = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!grid[r][c]) continue;
      let color = palette.body;
      if (isEdge(r, c)) color = palette.dark;
      else if (isBelly(r, c)) color = palette.accent + '88';
      pixels.push({ r, c, color });
    }
  }

  // Override map: paints accents, mouths, eyes, cheeks ON TOP of body color.
  const overrides = new Map<string, string>();

  // Pet-specific accent pixels (ear tabs, eye patches, snout, shell spots, chest LED)
  const accents = PET_ACCENTS[pet];
  accents?.forEach(([c, r]) => {
    if (grid[r] && grid[r][c]) overrides.set(`${r}-${c}`, palette.accent);
  });

  // Mouth pixels per state
  const mouth = PET_MOUTHS[pet][state];
  mouth?.forEach(([c, r]) => {
    if (grid[r] && grid[r][c]) overrides.set(`${r}-${c}`, palette.dark);
  });

  // Cheek pinks (idle only, only on body pixels)
  if (cheeks && state === 'idle') {
    cheeks.forEach(([c, r]) => {
      if (grid[r] && grid[r][c]) overrides.set(`${r}-${c}`, '#FFB7C5');
    });
  }

  // Eyes — drawn LAST so they always show. Blink only on idle.
  if (state === 'idle' && blink) {
    eyes.forEach(([c, r]) => overrides.set(`${r}-${c}`, palette.dark));
  } else {
    eyes.forEach(([c, r]) => overrides.set(`${r}-${c}`, palette.eye));
  }

  const anim = state === 'dispatch' ? 'pp-shake'
    : state === 'thinking' ? 'pp-tilt'
    : state === 'speaking' ? 'pp-talk'
    : 'pp-breath';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div
        className={`${anim} ${hovered ? 'pp-wiggle' : ''} ${jumping ? 'pp-jump' : ''}`}
        style={{
          width: RENDER_SIZE,
          height: RENDER_SIZE,
          position: 'relative',
          imageRendering: 'pixelated',
          flexShrink: 0,
        }}
      >
        {/* shadow on ground */}
        <div style={{
          position: 'absolute',
          left: '50%',
          bottom: -3,
          transform: 'translateX(-50%)',
          width: RENDER_SIZE * 0.6,
          height: 4,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(0,0,0,0.18), transparent 70%)',
        }} />
        {/* pixel grid */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'grid',
          gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
          gridTemplateRows: `repeat(${SIZE}, 1fr)`,
          gap: 0,
        }}>
          {pixels.map(({ r, c, color }) => {
            const k = `${r}-${c}`;
            const finalColor = overrides.get(k) ?? color;
            return (
              <div
                key={k}
                style={{
                  gridColumn: c + 1,
                  gridRow: r + 1,
                  background: finalColor,
                }}
              />
            );
          })}
        </div>
        <PetFaceOverlay pet={pet} state={state} blink={state === 'idle' && blink} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.2 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>Atlas</div>
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {state === 'idle' ? '待命' : state === 'thinking' ? '思考中' : state === 'dispatch' ? '调度中' : '回复中'}
        </div>
        <div style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)', opacity: 0.7, marginTop: 2 }}>
          {PET_NAMES[pet]} · {pet}
        </div>
      </div>

      <style>{`
        .pp-face {
          position: absolute;
          inset: 0;
          z-index: 3;
          pointer-events: none;
          image-rendering: auto;
        }
        .pp-face span,
        .pp-face i,
        .pp-face b {
          position: absolute;
          display: block;
          box-sizing: border-box;
        }
        .pp-face .pp-eye {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #fff;
          border: 2px solid rgba(17,17,17,0.92);
          box-shadow: 0 1px 0 rgba(255,255,255,0.35) inset;
          transform-origin: center;
          transition: transform 120ms ease;
        }
        .pp-face .pp-eye i {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #111;
          left: 7px;
          top: 7px;
        }
        .pp-face.is-blink .pp-eye {
          transform: scaleY(0.18);
        }
        .pp-face .pp-mouth {
          background: #16120d;
        }
        .pp-face-marmot .pp-ear {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #6B3F22;
          top: 9px;
          z-index: 0;
        }
        .pp-face-marmot .pp-ear.left { left: 22px; }
        .pp-face-marmot .pp-ear.right { right: 21px; }
        .pp-face-marmot .pp-eye.left { left: 27px; top: 29px; }
        .pp-face-marmot .pp-eye.right { right: 26px; top: 25px; }
        .pp-face-marmot .pp-nose {
          width: 7px;
          height: 5px;
          left: 45px;
          top: 47px;
          border-radius: 50%;
          background: #2A1B12;
          transform: rotate(10deg);
        }
        .pp-face-marmot .pp-nose::before,
        .pp-face-marmot .pp-nose::after {
          content: "";
          position: absolute;
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: #2A1B12;
          top: -1px;
        }
        .pp-face-marmot .pp-nose::before { left: -8px; }
        .pp-face-marmot .pp-nose::after { right: -8px; }
        .pp-face-marmot .pp-mouth {
          width: 3px;
          height: 22px;
          left: 48px;
          top: 54px;
          border-radius: 2px;
          transform-origin: top;
        }
        .pp-face-marmot.is-speaking .pp-mouth {
          width: 11px;
          height: 9px;
          left: 44px;
          top: 59px;
          border-radius: 50%;
        }
        .pp-face-marmot .pp-arm {
          width: 21px;
          height: 5px;
          border-radius: 999px;
          background: #6B3F22;
          top: 63px;
        }
        .pp-face-marmot .pp-arm.left {
          left: 13px;
          transform: rotate(34deg);
        }
        .pp-face-marmot .pp-arm.right {
          right: 12px;
          transform: rotate(-34deg);
        }
        .pp-face-robot .pp-antenna {
          width: 4px;
          height: 16px;
          left: 46px;
          top: 6px;
          border-radius: 999px;
          background: #6C77D9;
        }
        .pp-face-robot .pp-antenna::after {
          content: "";
          position: absolute;
          left: -5px;
          top: -7px;
          width: 14px;
          height: 10px;
          border-radius: 7px;
          background: #8B7FE8;
          box-shadow: 0 0 12px rgba(139,127,232,0.55);
        }
        .pp-face-robot .pp-ear {
          width: 11px;
          height: 26px;
          top: 36px;
          border-radius: 10px;
          background: #8B7FE8;
        }
        .pp-face-robot .pp-ear.left { left: 15px; }
        .pp-face-robot .pp-ear.right { right: 15px; }
        .pp-face-robot .pp-screen {
          left: 26px;
          top: 30px;
          width: 44px;
          height: 32px;
          border-radius: 14px;
          background: linear-gradient(180deg, #F6FBFF, #BEE9FF);
          border: 3px solid #2D2A78;
          box-shadow: 0 0 14px rgba(95,210,255,0.34) inset;
        }
        .pp-face-robot .pp-screen i {
          width: 7px;
          height: 9px;
          top: 9px;
          border-radius: 999px;
          background: #2D2A78;
        }
        .pp-face-robot .pp-screen i.left { left: 10px; }
        .pp-face-robot .pp-screen i.right { right: 10px; }
        .pp-face-robot.is-blink .pp-screen i {
          height: 2px;
          top: 13px;
        }
        .pp-face-robot .pp-screen b {
          left: 15px;
          bottom: 7px;
          width: 14px;
          height: 3px;
          border-radius: 99px;
          background: #2D2A78;
        }
        .pp-face-robot.is-speaking .pp-screen b {
          height: 7px;
          bottom: 5px;
        }
        .pp-face-robot .pp-glow {
          left: 39px;
          top: 66px;
          width: 18px;
          height: 9px;
          border-radius: 999px;
          background: rgba(95,210,255,0.72);
          filter: blur(2px);
        }
        .pp-face-fox .pp-ear {
          width: 20px;
          height: 22px;
          top: 15px;
          background: #9A4A1E;
          clip-path: polygon(50% 0, 100% 100%, 0 100%);
        }
        .pp-face-fox .pp-ear.left {
          left: 22px;
          transform: rotate(-18deg);
        }
        .pp-face-fox .pp-ear.right {
          right: 21px;
          transform: rotate(18deg);
        }
        .pp-face-fox .pp-muzzle {
          width: 48px;
          height: 34px;
          left: 24px;
          top: 42px;
          border-radius: 48% 48% 44% 44%;
          background: rgba(255,224,178,0.95);
        }
        .pp-face-fox .pp-eye.left { left: 29px; top: 32px; }
        .pp-face-fox .pp-eye.right { right: 29px; top: 32px; }
        .pp-face-fox .pp-nose {
          width: 9px;
          height: 7px;
          left: 44px;
          top: 53px;
          border-radius: 50%;
          background: #24130A;
        }
        .pp-face-fox .pp-mouth {
          width: 18px;
          height: 8px;
          left: 39px;
          top: 62px;
          border-radius: 0 0 18px 18px;
          background: transparent;
          border-bottom: 3px solid #24130A;
        }
        .pp-face-fox.is-speaking .pp-mouth {
          background: #24130A;
          border: none;
          border-radius: 50%;
        }
        .pp-face-turtle .pp-shell {
          width: 50px;
          height: 34px;
          left: 23px;
          top: 21px;
          border-radius: 50% 50% 42% 42%;
          background:
            linear-gradient(90deg, transparent 47%, rgba(47,122,85,0.45) 48%, rgba(47,122,85,0.45) 52%, transparent 53%),
            linear-gradient(150deg, transparent 42%, rgba(47,122,85,0.35) 43%, rgba(47,122,85,0.35) 47%, transparent 48%),
            linear-gradient(30deg, transparent 42%, rgba(47,122,85,0.35) 43%, rgba(47,122,85,0.35) 47%, transparent 48%),
            #B7F3C8;
          border: 3px solid #2F7A55;
        }
        .pp-face-turtle .pp-eye {
          width: 12px;
          height: 12px;
          border-width: 2px;
          top: 61px;
        }
        .pp-face-turtle .pp-eye.left { left: 35px; }
        .pp-face-turtle .pp-eye.right { right: 35px; }
        .pp-face-turtle .pp-eye i {
          width: 4px;
          height: 4px;
          left: 4px;
          top: 4px;
        }
        .pp-face-turtle .pp-mouth {
          width: 14px;
          height: 6px;
          left: 41px;
          top: 75px;
          background: transparent;
          border-bottom: 3px solid #0B2415;
          border-radius: 0 0 14px 14px;
        }
        .pp-face-turtle.is-speaking .pp-mouth {
          background: #0B2415;
          border: none;
          border-radius: 50%;
        }
        .pp-face-turtle .pp-fin {
          width: 17px;
          height: 11px;
          top: 65px;
          border-radius: 999px;
          background: #2F7A55;
        }
        .pp-face-turtle .pp-fin.left {
          left: 18px;
          transform: rotate(-24deg);
        }
        .pp-face-turtle .pp-fin.right {
          right: 18px;
          transform: rotate(24deg);
        }
        .pp-face-panda .pp-ear {
          width: 22px;
          height: 22px;
          top: 13px;
          border-radius: 50%;
          background: #2B2D42;
        }
        .pp-face-panda .pp-ear.left { left: 17px; }
        .pp-face-panda .pp-ear.right { right: 17px; }
        .pp-face-panda .pp-patch {
          width: 24px;
          height: 24px;
          top: 34px;
          border-radius: 50%;
          background: #2B2D42;
          transform: rotate(-12deg);
        }
        .pp-face-panda .pp-patch.left { left: 25px; }
        .pp-face-panda .pp-patch.right {
          right: 25px;
          transform: rotate(12deg);
        }
        .pp-face-panda .pp-patch i {
          width: 7px;
          height: 7px;
          left: 9px;
          top: 9px;
          border-radius: 50%;
          background: #fff;
          transition: transform 120ms ease;
        }
        .pp-face-panda.is-blink .pp-patch i {
          transform: scaleY(0.22);
        }
        .pp-face-panda .pp-nose {
          width: 10px;
          height: 8px;
          left: 43px;
          top: 59px;
          border-radius: 50%;
          background: #111827;
        }
        .pp-face-panda .pp-mouth {
          width: 18px;
          height: 8px;
          left: 39px;
          top: 67px;
          background: transparent;
          border-bottom: 3px solid #111827;
          border-radius: 0 0 18px 18px;
        }
        .pp-face-panda.is-speaking .pp-mouth {
          width: 12px;
          left: 42px;
          background: #111827;
          border: none;
          border-radius: 50%;
        }
        .pp-face.is-thinking {
          animation: pp-face-thinking 1.6s ease-in-out infinite;
        }
        .pp-face.is-dispatch {
          animation: pp-face-dispatch 0.8s ease-in-out infinite;
        }
        @keyframes pp-face-thinking {
          0%, 100% { transform: rotate(-1deg); }
          50% { transform: rotate(1.5deg) translateY(-1px); }
        }
        @keyframes pp-face-dispatch {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(1px); }
        }
        @keyframes pp-breath {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-1.5px); }
        }
        @keyframes pp-tilt {
          0%, 100% { transform: rotate(-2deg) translateY(0); }
          50% { transform: rotate(2deg) translateY(-1px); }
        }
        @keyframes pp-shake {
          0%, 100% { transform: translateX(0) translateY(0); }
          20% { transform: translateX(-1.5px) translateY(-1px); }
          40% { transform: translateX(1.5px) translateY(0); }
          60% { transform: translateX(-1px) translateY(-1.5px); }
          80% { transform: translateX(1px) translateY(0); }
        }
        @keyframes pp-talk {
          0%, 100% { transform: scale(1, 1); }
          50% { transform: scale(1.02, 0.98); }
        }
        @keyframes pp-zzz {
          0%, 100% { opacity: 0.3; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-3px); }
        }
        @keyframes pp-sweat {
          0%, 100% { opacity: 0.4; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-2px); }
        }
        @keyframes pp-talk-dot {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-2px); opacity: 1; }
        }
        @keyframes pp-wiggle-anim {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-4deg); }
          75% { transform: rotate(4deg); }
        }
        @keyframes pp-jump-anim {
          0%, 100% { transform: translateY(0); }
          40% { transform: translateY(-12px); }
          60% { transform: translateY(-8px); }
        }
        .pp-breath { animation: pp-breath 2.6s ease-in-out infinite; }
        .pp-tilt { animation: pp-tilt 2s ease-in-out infinite; }
        .pp-shake { animation: pp-shake 0.5s ease-in-out infinite; }
        .pp-talk { animation: pp-talk 0.4s ease-in-out infinite; }
        .pp-wiggle { animation: pp-wiggle-anim 0.5s ease-in-out 1; }
        .pp-jump { animation: pp-jump-anim 0.5s ease-out 1; }
      `}</style>
    </div>
  );
}

// ============================================================
// B: Aura — horizontal gradient light strip
// ============================================================
function AuraHeader({ state }: { state: OrbState }) {
  const colors: Record<OrbState, string> = {
    idle: 'transparent', thinking: 'rgba(139,127,232,0.06)',
    dispatch: 'rgba(139,127,232,0.12)', speaking: 'rgba(52,211,153,0.08)',
  };
  const active = state !== 'idle';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative', flex: 1 }}>
      {active && (
        <div style={{ position: 'absolute', inset: '-4px 0',
          background: `linear-gradient(90deg, transparent, ${colors[state]}, transparent)`,
          backgroundSize: '200% 100%', pointerEvents: 'none',
          animation: state === 'dispatch' ? 'aura-fast 1.5s linear infinite' : 'aura-slow 4s linear infinite' }} />
      )}
      <AtlasOrb state={state} size={32} showLabel={false} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Atlas</div>
        <div style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}>
          {state === 'idle' ? 'ONLINE' : state === 'thinking' ? 'THINK' : state === 'dispatch' ? 'DISPATCH' : 'REPLY'}
        </div>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, position: 'relative', zIndex: 1 }}>
        <span style={{ width: 4, height: 4, borderRadius: '50%', flexShrink: 0,
          background: state === 'idle' ? 'var(--color-success)' : state === 'dispatch' ? 'var(--accent)' : state === 'thinking' ? 'var(--color-warning)' : 'var(--color-success)',
          boxShadow: `0 0 4px ${state === 'idle' ? 'var(--color-success)' : state === 'dispatch' ? 'var(--accent)' : 'var(--color-warning)'}` }} />
        <span style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
          {state === 'idle' ? '1.2s' : state === 'dispatch' ? '0.8s' : state === 'thinking' ? '1.0s' : '0.9s'}
        </span>
      </div>
      <style>{`
        @keyframes aura-slow { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes aura-fast { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
      `}</style>
    </div>
  );
}

// ============================================================
// C: HUD Terminal
// ============================================================
function HUDHeader({ state }: { state: OrbState }) {
  const c: Record<OrbState, string> = { idle: 'var(--color-success)', thinking: 'var(--color-warning)', dispatch: 'var(--accent)', speaking: 'var(--color-success)' };
  const l: Record<OrbState, string> = { idle: 'STANDBY', thinking: 'ANALYZING', dispatch: 'DISPATCH', speaking: 'SPEAKING' };
  const wc = state === 'dispatch' ? 3 : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontFamily: 'var(--font-mono)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: c[state], fontSize: 13, fontWeight: 600 }}>&gt;</span>
        <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>atlas.status</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: c[state], letterSpacing: '0.06em', marginLeft: 'auto' }}>{l[state]}</span>
      </div>
      {state === 'dispatch' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9.5, color: 'var(--text-tertiary)' }}>[{wc} WORKERS]</span>
          <div style={{ flex: 1, height: 3, background: 'var(--border-subtle)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '65%', background: 'var(--accent)', borderRadius: 2, animation: 'aura-fast 1.5s linear infinite', backgroundSize: '200% 100%', backgroundImage: 'linear-gradient(90deg, var(--accent), #A59BF0, var(--accent))' }} />
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, fontSize: 9, color: 'var(--text-tertiary)' }}>
        <span>freq {state === 'dispatch' ? '0.8s' : '1.2s'}</span>
        <span>tok 2.4M</span>
        <span>hermes//atlas</span>
      </div>
    </div>
  );
}

// ============================================================
// ChatHeader
// ============================================================
export default function ChatHeader({ orbState, style, onStyleChange, pet: _pet, petAwakeSignal, profile = 'normal' }: Props) {
  const [hovered, setHovered] = useState(false);
  const [jumping, setJumping] = useState(false);

  const cycleStyle = useCallback(() => {
    const i = STYLES.indexOf(style);
    onStyleChange(STYLES[(i + 1) % STYLES.length]);
  }, [style, onStyleChange]);

  const handlePetClick = () => {
    setJumping(true);
    window.setTimeout(() => setJumping(false), 500);
  };

  return (
    <div style={{
      flexShrink: 0, borderBottom: '1px solid var(--border-subtle)',
      display: 'flex', alignItems: 'center',
      minHeight: style === 'pixel' ? 80 : style === 'hud' ? 56 : 48,
      padding: '6px 12px',
    }}>
      <div
        style={{ flex: 1, display: 'flex', alignItems: 'center' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={style === 'pixel' ? handlePetClick : undefined}
      >
        {style === 'pixel' && <MarmotSvgPet state={orbState} hovered={hovered} jumping={jumping} awakeSignal={petAwakeSignal} />}
        {style === 'aura'  && <AuraHeader state={orbState} />}
        {style === 'hud'   && <HUDHeader state={orbState} />}
      </div>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
        {profile !== 'normal' && (
          <span title={profile === 'read-only' ? '只读 Profile · 无写入权限' : '审计 Profile · 全量日志'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              height: 22, padding: '0 7px',
              borderRadius: 11,
              background: PROFILE_BADGE[profile].color,
              color: '#fff', fontSize: 10, fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.04em',
            }}
          >
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff', opacity: 0.95 }} />
            {PROFILE_BADGE[profile].label}
          </span>
        )}
        {style === 'pixel' && (
          <span
            title="唯一电子宠物 · 呆萌土拨鼠"
            style={{
              height: 26, padding: '0 10px', display: 'inline-flex', alignItems: 'center',
              borderRadius: 4, color: 'var(--accent)', fontSize: 11, fontWeight: 700,
              fontFamily: 'var(--font-mono)', background: 'var(--accent-soft)', border: 'none',
            }}
          >
            土拨鼠
          </span>
        )}
        <button onClick={cycleStyle} title={`风格 · ${STYLE_CHARS[style]}`}
          style={{ height: 26, padding: '0 10px', display: 'inline-flex', alignItems: 'center',
            borderRadius: 4, color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600,
            fontFamily: 'var(--font-mono)', cursor: 'pointer', background: 'var(--border-subtle)', border: 'none',
            transition: 'color 0.15s ease, background 0.15s ease' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; (e.currentTarget as HTMLElement).style.background = 'var(--accent-soft)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; (e.currentTarget as HTMLElement).style.background = 'var(--border-subtle)'; }}
        >{STYLE_CHARS[style]}</button>
      </div>
    </div>
  );
}
